import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Chat } from "./types";
import type { BusinessRow } from "./repo";
import { receiveClassified, receiveUnclassified, staffReply } from "./engine";
import { shoeSheet, testChat } from "./fixtures";

const sent: { kind: "text" | "template"; from: string; to: string; body?: string; name?: string; lang?: string; params?: string[] }[] = [];
let failTemplate: string[] = [];
vi.mock("./kapso", () => ({
  kapsoEnabled: () => true,
  sendText: vi.fn(async (from: string, to: string, body: string) => {
    sent.push({ kind: "text", from, to, body });
    return "wamid.1";
  }),
  sendTemplate: vi.fn(async (from: string, to: string, name: string, lang: string, params: string[]) => {
    if (failTemplate.includes(lang)) throw new Error(`template not approved in ${lang}`);
    sent.push({ kind: "template", from, to, name, lang, params });
    return "wamid.2";
  }),
}));
const { normalizePhone, newFlag, alertIfNeeded } = await import("./alerts");

const NOW = 1_800_000_000_000;
const sheet = shoeSheet();
const row = (alerts?: BusinessRow["data"]["alerts"]): BusinessRow => ({
  id: "b1",
  owner_id: "u1",
  data: { id: "b1", sheet, imported_history: false, live: true, alerts },
  kapso_phone_number_id: "597907523413541",
  wa_connected_at: null,
  wa_since: null,
  kapso_webhook_id: null,
  kapso_webhook_secret: null,
});
const on = { phone: "996555123456", enabled: true, lang: "ru" as const };
/** The assistant couldn't answer: the chat now needs a person. */
const missing = (chat: Chat, text: string) => receiveClassified(chat, text, { label: "info", reply: null, missing: true, path: "LLM" }, sheet, NOW);

beforeEach(() => {
  sent.length = 0;
  failTemplate = [];
  vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "jardamchy.vercel.app");
});
afterEach(() => vi.unstubAllEnvs());

describe("owner's number", () => {
  it("accepts the usual ways of writing a Kyrgyz number", () => {
    expect(normalizePhone("+996 555 123 456")).toBe("996555123456");
    expect(normalizePhone("0555 123 456")).toBe("996555123456");
    expect(normalizePhone("00996555123456")).toBe("996555123456");
    expect(normalizePhone("(996) 555-12-34-56")).toBe("996555123456");
    expect(normalizePhone("555")).toBeNull();
    expect(normalizePhone("позвоните мне")).toBeNull();
  });
});

describe("when to alert", () => {
  it("alerts when a chat starts needing a person, not again for the same reason", () => {
    const a = missing(testChat(), "Можно картой?");
    expect(newFlag(testChat(), a)?.reason).toBe("Missing answer");
    expect(newFlag(a, missing(a, "А парковка есть?"))).toBeNull();
    // A different reason is news.
    expect(newFlag(a, receiveUnclassified(a, "", "voice", NOW))?.reason).toBe("Voice/photo");
    // Staff answered: nothing to alert.
    expect(newFlag(a, staffReply(a, "Да", NOW))).toBeNull();
  });
});

describe("sending", () => {
  it("without a template, sends a plain message in the owner's language with a link to the chat", async () => {
    const before = testChat();
    expect(await alertIfNeeded(row(on), before, missing(before, "Можно картой?"))).toBe("sent");
    expect(sent).toEqual([
      {
        kind: "text",
        from: "597907523413541",
        to: "996555123456",
        body: "Jardamchy: клиент Test customer ждёт сотрудника (Нет ответа): «Можно картой?».\nОтветить: https://jardamchy.vercel.app/inbox?chat=test",
      },
    ]);
  });

  it("with an approved template, sends the template from the Jardamchy number; falls back to Russian", async () => {
    vi.stubEnv("ALERT_TEMPLATE", "needs_person");
    vi.stubEnv("ALERT_PHONE_NUMBER_ID", "111");
    failTemplate = ["ky_KG"];
    const before = testChat();
    await alertIfNeeded(row({ ...on, lang: "ky" }), before, missing(before, "Картадан төлөсө болобу?\n\nтез"));
    expect(sent).toEqual([
      {
        kind: "template",
        from: "111",
        to: "996555123456",
        name: "needs_person",
        lang: "ru",
        params: ["Test customer", "Картадан төлөсө болобу? тез", "https://jardamchy.vercel.app/inbox?chat=test"],
      },
    ]);
  });

  it("does nothing when alerts are off or not set up, and never throws", async () => {
    const before = testChat();
    const after = missing(before, "Можно картой?");
    expect(await alertIfNeeded(row(undefined), before, after)).toBe("skipped");
    expect(await alertIfNeeded(row({ ...on, enabled: false }), before, after)).toBe("skipped");
    vi.stubEnv("ALERT_TEMPLATE", "needs_person");
    failTemplate = ["ru"];
    expect(await alertIfNeeded(row(on), before, after)).toBe("failed");
    expect(sent).toEqual([]);
  });
});
