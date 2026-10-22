import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Chat, Sheet } from "./types";
import { checkMessage, numbersIn } from "./guard";
import { shoeChats, shoeSheet, testChat } from "./fixtures";
import { receiveClassified } from "./engine";

// A fake model: each test queues the JSON it should return.
const queue: unknown[] = [];
vi.mock("./llm", () => ({
  jsonCall: vi.fn(async () => {
    if (queue.length === 0) throw new Error("no fake response queued");
    return queue.shift();
  }),
  languageRule: () => "Russian",
}));

const { writeNewMessages, WriterError } = await import("./writer");
const { buildSheetWithAI } = await import("./sheetBuilder");
const { opsFromRequest } = await import("./editRequest");
const { validateOps } = await import("./edits");

const NOW = 1_000_000_000;
const confirmed = (s: Sheet): Sheet => ({
  ...s,
  prices: s.prices.map((p) => ({ ...p, needs_check: false })),
  availability: s.availability.map((n) => ({ ...n, needs_check: false })),
});

beforeEach(() => {
  queue.length = 0;
});

describe("guard", () => {
  const sheet = shoeSheet(); // prices still need checking
  const ok = confirmed(sheet);
  const customerTexts = ["Хочу заказать белые кроссовки 42 размер"];

  it("reads numbers with spaces and times", () => {
    expect(numbersIn("4 500 сом, в 19:00")).toEqual([4500, 19, 0]);
  });

  it("an answer may quote a confirmed price", () => {
    expect(checkMessage("Белые кроссовки стоят 4 500 сом.", { intent: { type: "answer" }, sheet: ok, customerTexts }).ok).toBe(true);
  });

  it("an answer may not quote a price that still needs checking", () => {
    expect(checkMessage("Белые кроссовки стоят 4500 сом.", { intent: { type: "answer" }, sheet, customerTexts }).ok).toBe(false);
  });

  it("an invented price is blocked", () => {
    const r = checkMessage("Кроссовки стоят 3900 сом.", { intent: { type: "answer" }, sheet: ok, customerTexts });
    expect(r).toEqual({ ok: false, reason: "number not in confirmed facts: 3900" });
  });

  it("a handoff may not mention prices, even confirmed ones", () => {
    expect(checkMessage("Сотрудник ответит. Кстати, кроссовки 4500.", { intent: { type: "handoff" }, sheet: ok, customerTexts }).ok).toBe(false);
  });

  it("the customer's own numbers and the request summary are allowed", () => {
    const intent = { type: "draft_done" as const, kind: "booking" as const, summary: "Столик на 4, завтра 19:00" };
    expect(checkMessage("Записала столик на 4 человек завтра в 7 вечера.", { intent, sheet, customerTexts }).ok).toBe(true);
  });

  it("blocks links, template brackets and long messages", () => {
    const g = { intent: { type: "greeting" as const }, sheet, customerTexts };
    expect(checkMessage("Пишите на www.shop.kg", g).ok).toBe(false);
    expect(checkMessage("Здравствуйте, {name}!", g).ok).toBe(false);
    expect(checkMessage("Раз. Два. Три. Четыре. Пять.", g).ok).toBe(false);
  });
});

describe("AI writer", () => {
  const sheet = confirmed(shoeSheet());

  function turn(text: string, decision: Parameters<typeof receiveClassified>[2]): [Chat, Chat] {
    const before = testChat();
    return [before, receiveClassified(before, text, decision, sheet, NOW)];
  }

  it("rewrites a fixed line in the AI's words", async () => {
    const [before, after] = turn("Напиши стих", { label: "off_topic", reply: null, missing: false, path: "LLM" });
    queue.push({ text: "Я помогаю только с ценами, наличием и доставкой. По другим вопросам вам напишет сотрудник." });
    const out = await writeNewMessages(before, after, sheet);
    const bot = out.messages.at(-1)!;
    expect(bot.written_by).toBe("ai");
    expect(bot.text).toMatch(/^Я помогаю только/);
  });

  it("retries once when the AI adds a number that isn't allowed", async () => {
    const [before, after] = turn("Хочу заказать белые кроссовки", {
      label: "order", reply: null, missing: false, path: "LLM", slots: { item: "Белые кроссовки" },
    });
    queue.push({ text: "Какой размер нужен? Есть 39." }, { text: "Подскажите, какой размер нужен?" });
    const out = await writeNewMessages(before, after, sheet);
    expect(out.messages.at(-1)!.text).toBe("Подскажите, какой размер нужен?");
  });

  it("gives up after two bad attempts instead of sending a canned line", async () => {
    const [before, after] = turn("Расскажи анекдот", { label: "off_topic", reply: null, missing: false, path: "LLM" });
    queue.push({ text: "Скидка 50% сегодня!" }, { text: "Скидка 30%!" });
    await expect(writeNewMessages(before, after, sheet)).rejects.toBeInstanceOf(WriterError);
  });

  it("an answer that invents a price becomes a handoff", async () => {
    const [before, after] = turn("Сколько стоят лоферы?", {
      label: "price", reply: "Лоферы стоят 3900 сом.", missing: false, path: "LLM",
    });
    queue.push({ text: "Уточню у сотрудника и вернусь с ответом." });
    const out = await writeNewMessages(before, after, sheet);
    expect(out.messages.at(-1)!.text).toBe("Уточню у сотрудника и вернусь с ответом.");
    expect(out.messages.at(-1)!.intent).toEqual({ type: "missing" });
    expect(out.needs_person?.reason).toBe("Missing answer");
  });

  it("keeps a correct answer from the reply model as is", async () => {
    const [before, after] = turn("Сколько стоят лоферы?", {
      label: "price", reply: "Чёрные лоферы — 5200 сом.", missing: false, path: "LLM",
    });
    const out = await writeNewMessages(before, after, sheet);
    expect(out.messages.at(-1)!.text).toBe("Чёрные лоферы — 5200 сом.");
  });
});

describe("AI sheet builder", () => {
  it("keeps only facts the chats back up, all marked check this", async () => {
    queue.push({
      hours: "10:00–20:00",
      address: "10 микрорайон, дом 34",
      prices: [
        { item: "Белые кроссовки", amount: 4500 },
        { item: "Сапоги", amount: 9999 }, // never said in the chats
      ],
      availability: ["Белые кроссовки: размеры 40–43", "Сапоги: размеры 36–40"],
      top_questions: ["Размер", "Цена"],
      tone_examples: ["Доставка по Бишкеку 200 сом, привезём завтра.", "Мы лучшие в городе!"],
    });
    const sheet = await buildSheetWithAI(shoeChats(NOW), "shop", "Обувь 10");
    expect(sheet.hours).toBe("10:00–20:00");
    expect(sheet.prices.map((p) => p.item)).toEqual(["Белые кроссовки"]);
    expect(sheet.prices.every((p) => p.needs_check)).toBe(true);
    expect(sheet.availability.map((n) => n.text)).toEqual(["Белые кроссовки: размеры 40–43"]);
    expect(sheet.tone_examples).toEqual(["Доставка по Бишкеку 200 сом, привезём завтра."]);
  });
});

describe("change request via AI", () => {
  it("turns the model's answer into checked operations", async () => {
    const { cafeSheet } = await import("./fixtures");
    const sheet = cafeSheet();
    const request = "лагман теперь 280, закрываемся в 23:00, и манты добавьте";
    queue.push({
      ops: [
        { op: "set_price", item: "Лагман", amount: 280, text: "" },
        { op: "set_hours", item: "", amount: 0, text: "09:00–23:00" },
        { op: "set_price", item: "Манты", amount: 300, text: "" },
      ],
      unclear: "Сколько стоят манты?",
    });
    const { ops, unclear } = await opsFromRequest(sheet, request);
    const checked = validateOps(ops, sheet, request);
    expect(checked.ok).toEqual([
      { op: "set_price", item: "Лагман", amount: 280 },
      { op: "set_hours", text: "09:00–23:00" },
    ]);
    expect(checked.dropped).toEqual(["price for «Манты»"]);
    expect(unclear).toBe("Сколько стоят манты?");
  });
});
