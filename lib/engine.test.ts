import { describe, expect, it } from "vitest";
import { cafeSheet, shoeSheet, testChat } from "./fixtures";
import { classify, decideWithRules } from "./rules";
import {
  PAUSE_MS,
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
  return receiveClassified(chat, text, decideWithRules(text, sheet), sheet.type, now);
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
