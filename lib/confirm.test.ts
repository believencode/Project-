import { describe, expect, it } from "vitest";
import { cafeChats, cafeSheet, shoeChats, shoeSheet } from "./fixtures";
import { attachSources } from "./sources";
import { applyAnswers, buildQuestions, parsePriceLines } from "./clarify";
import { applyOps, describeOp, validateOps } from "./edits";

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60_000;

describe("sources", () => {
  const sheet = attachSources(shoeSheet(), shoeChats(NOW));
  const price = (item: string) => sheet.prices.find((p) => p.item === item)!;

  it("links a price to the staff message that quoted it, even when the item was named earlier", () => {
    expect(price("Белые кроссовки").source).toMatchObject({ by: "chat", customer: "Айгерим", quote: "4500 сом." });
  });

  it("finds an older, different price for the same item", () => {
    expect(price("Чёрные лоферы").source?.customer).toBe("Нурлан");
    expect(price("Чёрные лоферы").alternatives).toEqual([
      { amount: 5000, source: expect.objectContaining({ customer: "Азамат", quote: "5000 сом." }) },
    ]);
  });

  it("doesn't mistake a delivery price for a product price", () => {
    expect(price("Чёрные лоферы").alternatives?.map((a) => a.amount)).not.toContain(200);
  });

  it("links hours, address and stock notes", () => {
    expect(sheet.hours_source?.customer).toBe("Бакыт");
    expect(sheet.address_source?.customer).toBe("Жылдыз");
    expect(sheet.availability[0].source?.quote).toBe("Здравствуйте! Да, есть 40–43 размеры.");
  });

  it("merges the same item listed twice, keeping the newest price", () => {
    const twice = { ...shoeSheet(), prices: [...shoeSheet().prices, { id: "p3", item: "Чёрные лоферы", amount: 5000, currency: "сом", needs_check: true }] };
    const merged = attachSources(twice, shoeChats(NOW));
    const loafers = merged.prices.filter((p) => p.item === "Чёрные лоферы");
    expect(loafers).toHaveLength(1);
    expect(loafers[0].amount).toBe(5200);
    expect(loafers[0].alternatives?.map((a) => a.amount)).toEqual([5000]);
  });

  it("café: lagman price comes from the chat", () => {
    const cafe = attachSources(cafeSheet(), cafeChats(NOW));
    expect(cafe.prices[0].source?.quote).toBe("250 сом.");
    expect(cafe.hours_source?.quote).toBe("С 09:00 до 22:00 без выходных.");
  });
});

describe("questions", () => {
  const sheet = attachSources(shoeSheet(), shoeChats(NOW));
  const qs = buildQuestions(sheet);

  it("asks one question per unclear fact", () => {
    expect(qs.map((q) => q.kind)).toEqual(["price", "price_conflict", "availability", "hours", "address"]);
  });

  it("applies the answers", () => {
    const out = applyAnswers(sheet, qs, {
      "price-p1": { action: "keep" },
      "conflict-p2": { action: "set_amount", amount: 5000 },
      "avail-a1": { action: "set_text", text: "Белые кроссовки: размеры 39–44" },
      hours: { action: "keep" },
      address: { action: "set_text", text: "Бишкек, 10 мкр, 34" },
    }, NOW);
    expect(out.prices.map((p) => [p.item, p.amount, p.needs_check])).toEqual([
      ["Белые кроссовки", 4500, false],
      ["Чёрные лоферы", 5000, false],
    ]);
    // Picking the older quote keeps that chat message as the source.
    expect(out.prices[1].source?.customer).toBe("Азамат");
    expect(out.availability[0]).toMatchObject({ text: "Белые кроссовки: размеры 39–44", needs_check: false, source: { by: "owner" } });
    expect(out.address_source?.by).toBe("owner");
    expect(buildQuestions(out)).toEqual([]);
  });

  it("asks for what wasn't found", () => {
    const empty = { ...cafeSheet(), hours: "", address: "", prices: [], availability: [] };
    expect(buildQuestions(empty).map((q) => q.kind)).toEqual(["prices_missing", "hours", "address"]);
  });

  it("removing a price drops it", () => {
    const out = applyAnswers(sheet, qs, { "price-p1": { action: "remove" } }, NOW);
    expect(out.prices.map((p) => p.item)).toEqual(["Чёрные лоферы"]);
  });

  it("reads typed price lines", () => {
    expect(parsePriceLines("Лагман 250\nМанты — 300 сом\nчто-то")).toEqual([
      { item: "Лагман", amount: 250 },
      { item: "Манты", amount: 300 },
    ]);
  });
});

describe("change requests", () => {
  const sheet = cafeSheet();

  it("keeps changes the request backs up and drops invented numbers", () => {
    const request = "лагман теперь 280, работаем до 23:00, добавьте манты";
    const { ok, dropped } = validateOps(
      [
        { op: "set_price", item: "Лагман", amount: 280 },
        { op: "set_hours", text: "09:00–23:00" },
        { op: "set_price", item: "Манты", amount: 300 }, // the owner never said 300
      ],
      sheet,
      request,
    );
    expect(ok).toHaveLength(2);
    expect(dropped).toEqual(["price for «Манты»"]);
  });

  it("describes and applies changes", () => {
    const ops = [
      { op: "set_price" as const, item: "лагман", amount: 280 },
      { op: "set_price" as const, item: "Манты", amount: 300 },
      { op: "set_hours" as const, text: "09:00–23:00" },
      { op: "remove_availability" as const, item: "Столик" },
    ];
    expect(ops.map((op) => describeOp(op, sheet))).toEqual([
      "Лагман: 250 → 280 сом",
      "Add price: Манты — 300 сом",
      "Hours: 09:00–22:00 → 09:00–23:00",
      "Remove stock note: «Столик на 4 человек в 19:00»",
    ]);
    const out = applyOps(sheet, ops, NOW + DAY);
    expect(out.prices.map((p) => [p.item, p.amount, p.needs_check, p.source?.by])).toEqual([
      ["Лагман", 280, false, "owner"],
      ["Манты", 300, false, "owner"],
    ]);
    expect(out.hours).toBe("09:00–23:00");
    expect(out.availability).toEqual([]);
  });

  it("a removal must name something that exists", () => {
    expect(validateOps([{ op: "remove_price", item: "Пицца" }], sheet, "уберите пиццу").dropped).toHaveLength(1);
  });
});
