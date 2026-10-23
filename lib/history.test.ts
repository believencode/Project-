import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDb, type Db } from "./db";
import { signUp } from "./auth";
import { connectWhatsApp, deleteImportedChats, getBusinessRow, loadBusiness, replaceBusiness, saveChat, type BusinessRow } from "./repo";
import { cafeSheet, shoeSheet, testChat } from "./fixtures";
import type { KapsoMessage } from "./kapso";
import type { Chat, Sheet } from "./types";

// A fake Kapso holding the shared chats, and a fake AI that "finds" a fixed sheet.
let messages: KapsoMessage[] = [];
let learned: Sheet;
vi.mock("./kapso", () => ({
  listMessages: vi.fn(async (_phone: string, o: { direction: string }) => messages.filter((m) => m.kapso?.direction === o.direction)),
}));
vi.mock("./llm", () => ({ llmEnabled: () => true }));
vi.mock("./sheetBuilder", () => ({ buildSheetWithAI: vi.fn(async () => learned) }));
const { historyChats, mergeLearned, importHistory } = await import("./whatsapp/history");

let n = 0;
const msg = (dir: "inbound" | "outbound", who: string, text: string, extra: Partial<KapsoMessage> & { origin?: string; name?: string } = {}): KapsoMessage => ({
  id: `wamid.${++n}`,
  timestamp: String(1_700_000_000 + n),
  type: "text",
  ...(dir === "inbound" ? { from: who } : { to: who }),
  text: { body: text },
  kapso: { direction: dir, origin: extra.origin ?? "history_sync", contact_name: extra.name },
  ...extra,
});

describe("shared WhatsApp chats", () => {
  it("become one imported chat per customer, with who wrote what", () => {
    const chats = historyChats([
      msg("inbound", "996555111", "Сколько стоит капучино?", { name: "Айгуль" }),
      msg("outbound", "996555111", "Капучино 180 сом"),
      msg("inbound", "996700222", "Вы работаете в воскресенье?"),
      // Not shared history: live messages and staff replies sent after connecting.
      msg("inbound", "996555111", "Привет", { origin: "cloud_api" }),
      msg("outbound", "996555111", "Здравствуйте", { origin: "business_app" }),
      // Photos and voice have no text to learn from.
      msg("inbound", "996555111", "", { type: "image", text: undefined }),
    ]);
    expect(chats.map((c) => [c.id, c.customer, c.imported, c.messages.map((m) => `${m.from}: ${m.text}`)])).toEqual([
      ["hist:996555111", "Айгуль", true, ["customer: Сколько стоит капучино?", "staff: Капучино 180 сом"]],
      ["hist:996700222", "+996700222", true, ["customer: Вы работаете в воскресенье?"]],
    ]);
  });

  it("adds only what the owner doesn't have, and every new fact waits for a check", () => {
    const current = { ...shoeSheet(), hours: "" };
    current.prices = current.prices.map((p) => ({ ...p, needs_check: false }));
    const found: Sheet = {
      ...shoeSheet(),
      hours: "10:00–21:00",
      address: "Другой адрес",
      prices: [
        { id: "p0", item: "белые кроссовки", amount: 9999, currency: "сом", needs_check: true },
        { id: "p1", item: "Сандалии", amount: 2500, currency: "сом", needs_check: false },
      ],
      availability: [],
      facts: [
        { id: "f0", topic: "доставка", text: "Доставка бесплатно", needs_check: true },
        { id: "f1", topic: "Оплата", text: "Можно оплатить через Мбанк.", needs_check: false },
      ],
    };
    const { sheet, added } = mergeLearned(current, found, "h1");
    // The owner's price stays as it was; only the new item is added, to be checked.
    expect(sheet.prices.map((p) => [p.id, p.item, p.amount, p.needs_check])).toEqual([
      ["p1", "Белые кроссовки", 4500, false],
      ["p2", "Чёрные лоферы", 5200, false],
      ["h1p0", "Сандалии", 2500, true],
    ]);
    expect(sheet.facts?.map((f) => f.topic)).toEqual(["Доставка", "Обмен", "Оплата"]);
    expect(sheet.facts?.at(-1)).toMatchObject({ id: "h1f0", needs_check: true });
    // Empty hours are filled; the owner's address is kept.
    expect(sheet.hours).toBe("10:00–21:00");
    expect(sheet.address).toBe(shoeSheet().address);
    expect(added).toBe(3);
  });
});

describe("importing them", () => {
  let db: Db;
  let row: BusinessRow;
  const live: Chat = { ...testChat(), id: "wa:996777333", is_test: false, is_whatsapp: true, customer: "Live" };

  beforeEach(async () => {
    messages = [];
    learned = { ...cafeSheet(), prices: [{ id: "p0", item: "Капучино", amount: 180, currency: "сом", needs_check: true }] };
    db = await openDb({ memory: true });
    const owner = await signUp(db, "owner@cafe.kg", "secret123");
    row = await replaceBusiness(db, owner, { id: "b1", sheet: cafeSheet("Кафе Ала-Тоо"), chats: [testChat()], imported_history: false, live: true });
    await connectWhatsApp(db, row.id, "555");
    await saveChat(db, row.id, live);
    row = (await getBusinessRow(db, owner))!;
  });

  it("says so when nothing was shared yet", async () => {
    messages = [msg("inbound", "996555111", "Привет", { origin: "cloud_api" })];
    expect(await importHistory(db, row)).toEqual({ status: "empty" });
  });

  it("saves the chats, adds the facts to check, and can be read again without duplicates", async () => {
    messages = [msg("inbound", "996555111", "Сколько капучино?"), msg("outbound", "996555111", "Капучино 180 сом")];
    expect(await importHistory(db, row)).toEqual({ status: "done", chats: 1, added: 1 });
    expect(await importHistory(db, row)).toEqual({ status: "done", chats: 1, added: 0 });

    const b = await loadBusiness(db, (await getBusinessRow(db, row.owner_id))!);
    expect(b.imported_history).toBe(true);
    expect(b.sheet.prices.find((p) => p.item === "Капучино")).toMatchObject({ amount: 180, needs_check: true });
    expect(b.chats.map((c) => c.id).sort()).toEqual(["hist:996555111", "test", "wa:996777333"]);
    expect(b.chats.find((c) => c.id === "hist:996555111")?.messages).toHaveLength(2);
  });

  it("deleting imported chats keeps the live WhatsApp chats and the test chat", async () => {
    messages = [msg("inbound", "996555111", "Сколько капучино?")];
    await importHistory(db, row);
    await deleteImportedChats(db, row.id);
    const b = await loadBusiness(db, (await getBusinessRow(db, row.owner_id))!);
    expect(b.chats.map((c) => c.id).sort()).toEqual(["test", "wa:996777333"]);
    expect(b.imported_history).toBe(false);
  });
});
