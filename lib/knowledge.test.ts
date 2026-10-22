import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Chat, InfoFact, Sheet } from "./types";
import { cafeSheet, shoeChats, shoeSheet, testChat } from "./fixtures";
import { bestFact, pendingSuggestions, relevantFacts, relevantPrices, unansweredQuestion } from "./knowledge";
import { checkMessage } from "./guard";
import { decideWithRules } from "./rules";
import { receiveClassified, staffReply } from "./engine";
import { attachSources } from "./sources";
import { applyOps, validateOps } from "./edits";

// A fake model for the fact suggestions.
const queue: unknown[] = [];
let aiOn = true;
vi.mock("./llm", () => ({
  jsonCall: vi.fn(async () => {
    if (queue.length === 0) throw new Error("no fake response queued");
    return queue.shift();
  }),
  llmEnabled: () => aiOn,
}));
const { suggestFact } = await import("./learn");

const NOW = 1_800_000_000_000;

const confirmedSheet = (): Sheet => {
  const s = shoeSheet();
  return {
    ...s,
    prices: s.prices.map((p) => ({ ...p, needs_check: false })),
    availability: s.availability.map((n) => ({ ...n, needs_check: false })),
    facts: s.facts?.map((f) => ({ ...f, needs_check: false })),
  };
};

beforeEach(() => {
  queue.length = 0;
  aiOn = true;
});

describe("picking facts for a question", () => {
  it("sends every confirmed fact when there are few, and never unconfirmed ones", () => {
    const sheet = confirmedSheet();
    sheet.facts![1].needs_check = true;
    expect(relevantFacts(sheet, "Доставка есть?").map((f) => f.topic)).toEqual(["Доставка"]);
  });

  it("picks the matching facts from a large knowledge base", () => {
    const filler: InfoFact[] = Array.from({ length: 40 }, (_, i) => ({ id: `x${i}`, topic: `Тема ${i}`, text: `Правило номер ${i} про подарочные сертификаты`, needs_check: false }));
    const sheet = { ...confirmedSheet(), facts: [...filler, ...confirmedSheet().facts!] };
    const picked = relevantFacts(sheet, "Сколько стоит доставка?");
    expect(picked[0].topic).toBe("Доставка");
    expect(picked.length).toBeLessThanOrEqual(12);
  });

  it("narrows a large catalog to the items being discussed", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ id: `q${i}`, item: `Модель ${i}`, amount: 1000 + i, currency: "сом", needs_check: false }));
    const sheet = { ...confirmedSheet(), prices: [...many, ...confirmedSheet().prices] };
    const picked = relevantPrices(sheet, "а лоферы?", [{ from: "customer", text: "Сколько стоят белые кроссовки?" }]);
    expect(picked.slice(0, 2).map((p) => p.item).sort()).toEqual(["Белые кроссовки", "Чёрные лоферы"]);
  });

  it("finds the best fact without AI (demo mode)", () => {
    expect(bestFact(confirmedSheet(), "Можно обменять обувь?")?.topic).toBe("Обмен");
    expect(bestFact(confirmedSheet(), "Есть парковка?")).toBeUndefined();
  });
});

describe("answering from facts", () => {
  it("answers a delivery question from a confirmed fact (demo mode)", () => {
    const d = decideWithRules("Доставка есть?", confirmedSheet());
    expect(d).toMatchObject({ label: "info", missing: false });
    expect(d.reply).toContain("200");
  });

  it("passes the question to a person when the fact is missing or unconfirmed", () => {
    expect(decideWithRules("Можно оплатить картой?", confirmedSheet())).toMatchObject({ label: "info", missing: true });
    expect(decideWithRules("Доставка есть?", shoeSheet())).toMatchObject({ label: "info", missing: true });
  });

  it("lets the AI quote numbers from confirmed facts and item details only", () => {
    const sheet = confirmedSheet();
    sheet.prices[0].details = "Кожа, подошва 3 см";
    const input = { intent: { type: "answer" } as const, sheet, customerTexts: ["Доставка есть?"] };
    expect(checkMessage("Да, доставка по Бишкеку 200 сом.", input).ok).toBe(true);
    expect(checkMessage("Подошва 3 см.", input).ok).toBe(true);
    expect(checkMessage("Доставка 300 сом.", input).ok).toBe(false);
    expect(checkMessage("Доставка 200 сом.", { ...input, sheet: shoeSheet() }).ok).toBe(false);
  });

  it("finds the chat message a fact came from", () => {
    const sheet = attachSources(shoeSheet(), shoeChats(NOW));
    expect(sheet.facts?.[0].source).toMatchObject({ customer: "Нурлан", quote: "Доставка по Бишкеку 200 сом, привезём завтра." });
    expect(sheet.facts?.[1].source).toMatchObject({ customer: "Эрлан" });
  });
});

describe("learning from staff answers", () => {
  const sheet = confirmedSheet();
  /** The bot couldn't answer «Можно оплатить картой?», then staff replied. */
  function askedThenStaff(...replies: string[]): Chat {
    let chat = receiveClassified(testChat(), "Можно оплатить картой?", { label: "info", reply: null, missing: true, path: "LLM" }, sheet, NOW);
    replies.forEach((r, i) => (chat = staffReply(chat, r, NOW + 10_000 * (i + 1))));
    return chat;
  }

  it("finds the open question and the staff answers to it", () => {
    const open = unansweredQuestion(askedThenStaff("Сейчас уточню", "Да, принимаем карты и Мбанк"), NOW + 60_000);
    expect(open).toMatchObject({ question: "Можно оплатить картой?", answers: ["Сейчас уточню", "Да, принимаем карты и Мбанк"] });
    expect(unansweredQuestion(askedThenStaff(), NOW)).toBeNull();
    // A day later it's too old to learn from.
    expect(unansweredQuestion(askedThenStaff("Да"), NOW + 2 * 24 * 60 * 60_000)).toBeNull();
  });

  it("proposes a fact the owner can add", async () => {
    queue.push({ useful: true, topic: "Оплата", text: "Принимаем карты и Мбанк." });
    const chat = await suggestFact(askedThenStaff("Да, принимаем карты и Мбанк"), NOW + 60_000);
    expect(chat.fact_suggestions).toEqual([
      expect.objectContaining({ question: "Можно оплатить картой?", topic: "Оплата", text: "Принимаем карты и Мбанк." }),
    ]);
    expect(pendingSuggestions([chat])).toHaveLength(1);
  });

  it("skips replies that aren't facts, and facts with numbers staff didn't write", async () => {
    queue.push({ useful: false, topic: "", text: "" });
    const chat = askedThenStaff("Сейчас уточню");
    expect(await suggestFact(chat, NOW + 60_000)).toBe(chat);
    queue.push({ useful: true, topic: "Оплата", text: "Комиссия 3%." });
    const chat2 = askedThenStaff("Да, картой можно");
    expect(await suggestFact(chat2, NOW + 60_000)).toBe(chat2);
  });

  it("replaces the suggestion as staff add more, but not after the owner decided", async () => {
    queue.push({ useful: true, topic: "Оплата", text: "Принимаем карты." });
    let chat = await suggestFact(askedThenStaff("Да, картой можно"), NOW + 60_000);
    chat = staffReply(chat, "И Мбанк тоже", NOW + 70_000);
    queue.push({ useful: true, topic: "Оплата", text: "Принимаем карты и Мбанк." });
    chat = await suggestFact(chat, NOW + 80_000);
    expect(chat.fact_suggestions?.map((s) => s.text)).toEqual(["Принимаем карты и Мбанк."]);
    chat = { ...chat, fact_suggestions: chat.fact_suggestions!.map((s) => ({ ...s, status: "dismissed" as const })) };
    expect(await suggestFact(staffReply(chat, "Наличными тоже", NOW + 90_000), NOW + 90_000)).toMatchObject({ fact_suggestions: chat.fact_suggestions });
    expect(pendingSuggestions([chat])).toHaveLength(0);
  });

  it("without AI, proposes the staff answer as it is", async () => {
    aiOn = false;
    const chat = await suggestFact(askedThenStaff("Да, принимаем карты"), NOW + 60_000);
    expect(chat.fact_suggestions?.[0]).toMatchObject({ topic: "", text: "Да, принимаем карты" });
  });
});

describe("owner edits to facts", () => {
  it("adds, changes and removes facts and item details from a request", () => {
    const sheet = confirmedSheet();
    const request = "доставка теперь 250 сом, обмена нет, лоферы из натуральной кожи, принимаем Мбанк";
    const { ok, dropped } = validateOps(
      [
        { op: "set_fact", topic: "Доставка", text: "Доставка по Бишкеку — 250 сом." },
        { op: "remove_fact", topic: "обмен" },
        { op: "set_details", item: "лоферы", text: "Натуральная кожа" },
        { op: "set_fact", topic: "Оплата", text: "Принимаем Мбанк." },
        { op: "set_fact", topic: "Скидки", text: "Скидка 10% по пятницам." },
      ],
      sheet,
      request,
    );
    expect(dropped).toEqual(["«Скидки»"]);
    const out = applyOps(sheet, ok, NOW);
    expect(out.facts?.map((f) => `${f.topic}: ${f.text}`)).toEqual(["Доставка: Доставка по Бишкеку — 250 сом.", "Оплата: Принимаем Мбанк."]);
    expect(out.prices.find((p) => p.item === "Чёрные лоферы")?.details).toBe("Натуральная кожа");
  });

  it("works on sheets made before the knowledge base", () => {
    const old = cafeSheet();
    delete old.facts;
    const out = applyOps(old, [{ op: "set_fact", topic: "Парковка", text: "Есть парковка у входа." }], NOW);
    expect(out.facts).toHaveLength(1);
  });
});

describe("guard: mixed alphabets", () => {
  it("rejects Latin letters inside a Cyrillic word, allows Latin words on their own", () => {
    const input = { intent: { type: "greeting" } as const, sheet: shoeSheet(), customerTexts: [] };
    expect(checkMessage("Бир аз күтө turуңуз.", input).ok).toBe(false);
    expect(checkMessage("Жооп берebiz.", input).ok).toBe(false);
    expect(checkMessage("Пишите в WhatsApp, ответим.", input).ok).toBe(true);
  });

  it("allows the number in the business's own name", () => {
    const input = { intent: { type: "greeting" } as const, sheet: shoeSheet("Обувь 10"), customerTexts: [] };
    expect(checkMessage("Добро пожаловать в «Обувь 10»!", input).ok).toBe(true);
    expect(checkMessage("Мы работаем до 20:00.", input).ok).toBe(false);
  });
});
