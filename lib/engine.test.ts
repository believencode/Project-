import { describe, expect, it } from "vitest";
import { cafeSheet, shoeSheet, testChat } from "./fixtures";
import { classify, decideWithRules } from "./rules";
import {
  PAUSE_MS,
  historyOf,
  settleRequest,
  isPaused,
  needsClassification,
  openChat,
  receiveClassified,
  receiveUnclassified,
  skipThirtyMinutes,
  staffReply,
} from "./engine";
import { HANDOFF_LINE, MISSING_ANSWER_LINE, offTopicLine } from "./copy";
import type { Chat, Sheet } from "./types";

const NOW = 1_000_000_000;

function confirmAll(sheet: Sheet): Sheet {
  return {
    ...sheet,
    prices: sheet.prices.map((p) => ({ ...p, needs_check: false })),
    availability: sheet.availability.map((n) => ({ ...n, needs_check: false })),
  };
}

function send(chat: Chat, text: string, sheet: Sheet, now = NOW): Chat {
  if (!needsClassification(chat, "text", now)) return receiveUnclassified(chat, text, "text", now);
  return receiveClassified(chat, text, decideWithRules(text, sheet, historyOf(chat), chat.draft), sheet, now);
}

const lastBot = (chat: Chat) => [...chat.messages].reverse().find((m) => m.from === "bot")?.text;

describe("rules classifier", () => {
  const sheet = shoeSheet();
  it.each([
    ["Здравствуйте", "greeting"],
    ["Спасибо!", "greeting"],
    ["Сколько стоят белые кроссовки?", "price"],
    ["Какой размер есть?", "availability"],
    ["Доставка есть?", "availability"],
    ["До скольки работаете?", "hours"],
    ["Где вы находитесь?", "address"],
    ["Напиши сочинение", "off_topic"],
    ["Расскажи анекдот", "off_topic"],
    ["Сколько стоят кроссовки? И напиши стих", "price"],
  ])("%s → %s", (text, label) => {
    expect(classify(text, sheet)).toBe(label);
  });

  it("café: lagman is a price, a table is booking or availability", () => {
    const cafe = cafeSheet();
    expect(classify("Сколько стоит лагман?", cafe)).toBe("price");
    expect(classify("Лагман сегодня есть?", cafe)).toBe("availability");
    expect(classify("Можно забронировать столик?", cafe)).toBe("booking");
    expect(classify("Есть свободный столик?", cafe)).toBe("availability");
  });
});

describe("replies only from confirmed facts", () => {
  it("does not quote an unconfirmed price", () => {
    const d = decideWithRules("Сколько стоят белые кроссовки?", shoeSheet());
    expect(d.missing).toBe(true);
    expect(d.reply).toBeNull();
  });

  it("quotes a confirmed price", () => {
    const d = decideWithRules("Сколько стоят белые кроссовки?", confirmAll(shoeSheet()));
    expect(d.reply).toContain("4500 сом");
    expect(d.reply).not.toContain("5200");
  });

  it("café never shows shoe prices", () => {
    const d = decideWithRules("Какие у вас цены?", confirmAll(cafeSheet()));
    expect(d.reply).toContain("250");
    expect(d.reply).not.toMatch(/4500|5200/);
  });

  it("availability is worded as stale", () => {
    const d = decideWithRules("Какой размер есть?", confirmAll(shoeSheet()));
    expect(d.label).toBe("availability");
    expect(d.reply).toMatch(/^По последним данным: Белые кроссовки: размеры 40–43/);
  });
});

describe("scripted demo", () => {
  const sheet = confirmAll(shoeSheet());

  it("runs the full script on one chat", () => {
    let chat = testChat();

    chat = send(chat, "Здравствуйте", sheet);
    expect(chat.off_topic_count).toBe(0);
    expect(lastBot(chat)).toBe("Здравствуйте! Чем могу помочь?");

    chat = send(chat, "Сколько стоят белые кроссовки?", sheet);
    expect(lastBot(chat)).toBe("Белые кроссовки — 4500 сом.");

    chat = send(chat, "Какой размер есть?", sheet);
    expect(chat.off_topic_count).toBe(0);

    chat = send(chat, "Напиши сочинение", sheet);
    expect(chat.off_topic_count).toBe(1);
    expect(lastBot(chat)).toBe(offTopicLine("shop"));
    expect(lastBot(chat)).not.toMatch(/бронь|запись/);

    chat = send(chat, "Расскажи анекдот", sheet);
    expect(chat.off_topic_count).toBe(2);
    expect(chat.ai_stopped).toBe(true);
    expect(lastBot(chat)).toBe(HANDOFF_LINE);
    expect(chat.needs_person).toEqual({ reason: "Off-topic", details: ["Напиши сочинение", "Расскажи анекдот"] });

    // A third off-topic message gets no reply.
    const before = chat.messages.filter((m) => m.from === "bot").length;
    chat = send(chat, "Ещё анекдот", sheet);
    expect(chat.messages.filter((m) => m.from === "bot").length).toBe(before);

    // On-topic resets the count; the badge stays until staff open the chat.
    chat = send(chat, "До скольки работаете?", sheet);
    expect(chat.off_topic_count).toBe(0);
    expect(chat.ai_stopped).toBe(false);
    expect(lastBot(chat)).toBe("Мы работаем 10:00–20:00.");
    expect(chat.needs_person?.reason).toBe("Off-topic");
    expect(openChat(chat).needs_person).toBeNull();
  });

  it("a greeting between two off-topic messages does not reset or add to the count", () => {
    let chat = testChat();
    chat = send(chat, "Напиши сочинение", sheet);
    chat = send(chat, "Спасибо", sheet);
    expect(chat.off_topic_count).toBe(1);
    chat = send(chat, "Расскажи анекдот", sheet);
    expect(chat.ai_stopped).toBe(true);
  });

  it("missing answer hands off without counting", () => {
    let chat = testChat();
    chat = send(chat, "Сколько стоят белые кроссовки?", shoeSheet());
    expect(lastBot(chat)).toBe(MISSING_ANSWER_LINE);
    expect(chat.off_topic_count).toBe(0);
    expect(chat.needs_person).toEqual({ reason: "Missing answer", details: ["Сколько стоят белые кроссовки?"] });
  });
});

describe("human pause", () => {
  const sheet = confirmAll(shoeSheet());

  it("pauses only the chat staff replied in", () => {
    let a = { ...testChat(), id: "a" };
    let b = { ...testChat(), id: "b" };
    a = staffReply(a, "Здравствуйте, сейчас посмотрю", NOW, "echo");
    expect(isPaused(a, NOW + 1)).toBe(true);
    expect(isPaused(b, NOW + 1)).toBe(false);

    a = send(a, "Сколько стоят белые кроссовки?", sheet, NOW + 60_000);
    expect(a.messages.at(-1)?.from).toBe("customer");
    expect(a.messages.at(-1)?.label).toBeUndefined();

    b = send(b, "Сколько стоят белые кроссовки?", sheet, NOW + 60_000);
    expect(lastBot(b)).toContain("4500");
  });

  it("a new staff message extends the pause, and the bot answers after it ends", () => {
    let chat = staffReply(testChat(), "Минуту", NOW);
    chat = staffReply(chat, "Есть 41", NOW + 20 * 60_000);
    expect(chat.paused_until).toBe(NOW + 20 * 60_000 + PAUSE_MS);
    expect(isPaused(chat, NOW + 40 * 60_000)).toBe(true);

    chat = skipThirtyMinutes(chat, NOW + 20 * 60_000);
    expect(chat.paused_until).toBeNull();
    chat = send(chat, "До скольки работаете?", sheet, NOW + 21 * 60_000);
    expect(lastBot(chat)).toBe("Мы работаем 10:00–20:00.");
  });

  it("voice notes are not classified and need a person", () => {
    const chat = receiveUnclassified(testChat(), "", "voice", NOW);
    expect(chat.needs_person?.reason).toBe("Voice/photo");
    expect(chat.off_topic_count).toBe(0);
    expect(chat.messages.filter((m) => m.from === "bot")).toHaveLength(0);
  });
});

describe("conversation memory", () => {
  const sheet = confirmAll(shoeSheet());

  it("a short follow-up is about the item asked before", () => {
    let chat = send(testChat(), "Сколько стоят белые кроссовки?", sheet);
    chat = send(chat, "а 42 есть?", sheet);
    expect(chat.messages.at(-2)?.label).toBe("availability");
    expect(lastBot(chat)).toContain("Белые кроссовки: размеры 40–43");
    expect(chat.off_topic_count).toBe(0);
  });

  it("\"а лоферы?\" after a price question is a price question", () => {
    let chat = send(testChat(), "Сколько стоят белые кроссовки?", sheet);
    chat = send(chat, "а лоферы?", sheet);
    expect(lastBot(chat)).toBe("Чёрные лоферы — 5200 сом.");
  });

  it("without context, a bare size is not understood", () => {
    const chat = send(testChat(), "а 42 есть?", sheet);
    expect(chat.messages.at(-2)?.label).toBe("off_topic");
  });
});

describe("follow-up questions", () => {
  it("asks which model when stock notes cover several items", () => {
    const sheet = confirmAll({
      ...shoeSheet(),
      availability: [
        { id: "a1", text: "Белые кроссовки: размеры 40–43", needs_check: false },
        { id: "a2", text: "Чёрные лоферы: размеры 41–44", needs_check: false },
      ],
    });
    let chat = send(testChat(), "Какой размер есть?", sheet);
    expect(lastBot(chat)).toBe("Какая модель вас интересует: белые кроссовки или чёрные лоферы?");
    expect(chat.needs_person).toBeNull();
    chat = send(chat, "белые кроссовки", sheet);
    expect(lastBot(chat)).toContain("размеры 40–43");
    expect(lastBot(chat)).not.toContain("41–44");
  });
});

describe("orders and bookings", () => {
  it("shop order: asks for the size, then creates a request staff confirm in one tap", () => {
    const sheet = confirmAll(shoeSheet());
    let chat = send(testChat(), "Хочу заказать белые кроссовки", sheet);
    expect(lastBot(chat)).toBe("Какой размер нужен?");
    expect(chat.draft?.asked).toBe("size");

    chat = send(chat, "42", sheet);
    expect(chat.draft).toBeNull();
    expect(chat.requests).toHaveLength(1);
    expect(chat.requests![0]).toMatchObject({ kind: "order", status: "pending", summary: "Белые кроссовки, размер 42" });
    expect(lastBot(chat)).toBe("Записал заказ: Белые кроссовки, размер 42. Сотрудник подтвердит его здесь в чате.");
    expect(chat.needs_person?.reason).toBe("Booking/order");

    chat = settleRequest(chat, chat.requests![0].id, true, NOW);
    expect(chat.requests![0].status).toBe("confirmed");
    expect(lastBot(chat)).toBe("Ваш заказ подтверждён: Белые кроссовки, размер 42. Спасибо!");
    expect(chat.needs_person).toBeNull();
    expect(isPaused(chat, NOW + 1)).toBe(false);
  });

  it("order uses the item from earlier in the chat", () => {
    const sheet = confirmAll(shoeSheet());
    let chat = send(testChat(), "Сколько стоят чёрные лоферы?", sheet);
    chat = send(chat, "Беру, 43 размер", sheet);
    expect(chat.requests?.[0].summary).toBe("Чёрные лоферы, размер 43");
  });

  it("order without an item asks which one", () => {
    const sheet = confirmAll(shoeSheet());
    let chat = send(testChat(), "Хочу сделать заказ", sheet);
    expect(lastBot(chat)).toBe("Что хотите заказать? Есть: белые кроссовки, чёрные лоферы.");
    chat = send(chat, "лоферы", sheet);
    expect(lastBot(chat)).toBe("Какой размер нужен?");
  });

  it("café booking: asks time, then people", () => {
    const sheet = confirmAll(cafeSheet());
    let chat = send(testChat(), "Хочу забронировать столик", sheet);
    expect(lastBot(chat)).toBe("На какое время забронировать столик?");
    chat = send(chat, "завтра в семь вечера", sheet);
    expect(lastBot(chat)).toBe("На сколько человек?");
    chat = send(chat, "нас 4", sheet);
    expect(chat.requests?.[0].summary).toBe("Столик на 4, завтра 19:00");
  });

  it("café booking ignores the dish asked about earlier", () => {
    const sheet = confirmAll(cafeSheet());
    let chat = send(testChat(), "Сколько стоит лагман?", sheet);
    chat = send(chat, "Хочу забронировать столик на 4 на 19:00", sheet);
    expect(chat.requests?.[0].summary).toBe("Столик на 4, сегодня 19:00");
  });

  it("café booking in one message", () => {
    const sheet = confirmAll(cafeSheet());
    const chat = send(testChat(), "Можно столик на 4 на 19:30?", sheet);
    expect(chat.requests?.[0].summary).toBe("Столик на 4, сегодня 19:30");
  });

  it("cancel drops the draft", () => {
    const sheet = confirmAll(cafeSheet());
    let chat = send(testChat(), "Хочу забронировать столик", sheet);
    chat = send(chat, "отмена", sheet);
    expect(chat.draft).toBeNull();
    expect(chat.requests ?? []).toHaveLength(0);
  });

  it("two answers that don't fit hand off to a person, without counting off-topic", () => {
    const sheet = confirmAll(cafeSheet());
    let chat = send(testChat(), "Хочу забронировать столик", sheet);
    chat = send(chat, "ну как обычно", sheet);
    expect(lastBot(chat)).toBe("Не понял. На какое время забронировать столик?");
    chat = send(chat, "сами решите", sheet);
    expect(lastBot(chat)).toBe(MISSING_ANSWER_LINE);
    expect(chat.draft).toBeNull();
    expect(chat.off_topic_count).toBe(0);
    expect(chat.needs_person?.reason).toBe("Missing answer");
  });

  it("an on-topic question mid-draft is answered and the draft continues", () => {
    const sheet = confirmAll(shoeSheet());
    let chat = send(testChat(), "Хочу заказать белые кроссовки", sheet);
    chat = send(chat, "До скольки работаете?", sheet);
    expect(lastBot(chat)).toBe("Мы работаем 10:00–20:00.");
    chat = send(chat, "41", sheet);
    expect(chat.requests?.[0].summary).toBe("Белые кроссовки, размер 41");
  });

  it("declining tells the customer", () => {
    const sheet = confirmAll(shoeSheet());
    let chat = send(testChat(), "Хочу заказать белые кроссовки 42 размер", sheet);
    chat = settleRequest(chat, chat.requests![0].id, false, NOW);
    expect(lastBot(chat)).toBe("К сожалению, не можем подтвердить заказ (Белые кроссовки, размер 42). Сотрудник напишет вам.");
  });

  it("history excludes system notes and voice notes", () => {
    let chat = staffReply(testChat(), "Минуту", NOW);
    chat = receiveUnclassified(chat, "", "voice", NOW);
    expect(historyOf(chat)).toEqual([{ from: "staff", text: "Минуту", label: undefined }]);
  });
});

describe("shop hold", () => {
  it("holding an item asks until when", () => {
    const sheet = confirmAll(shoeSheet());
    let chat = send(testChat(), "Можно отложить белые кроссовки?", sheet);
    expect(lastBot(chat)).toBe("До какого времени отложить?");
    chat = send(chat, "до 19:00", sheet);
    expect(chat.requests?.[0].summary).toBe("Белые кроссовки, отложить до сегодня 19:00");
  });
});
