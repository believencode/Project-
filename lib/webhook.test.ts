import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A fake Kapso: record what would be sent to WhatsApp.
const sent: { to: string; body: string }[] = [];
vi.mock("./kapso", () => ({
  sendText: vi.fn(async (_phone: string, to: string, body: string) => {
    sent.push({ to, body });
    return `wamid.out.${sent.length}`;
  }),
  KapsoError: class extends Error {},
}));

const { openDb } = await import("./db");
const { signUp } = await import("./auth");
const { connectWhatsApp, loadChat, replaceBusiness, setWebhook, updateBusinessData } = await import("./repo");
const { receiveWebhook, signatureValid } = await import("./whatsapp/webhook");
const { demoBusiness } = await import("./demo");
const { isPaused } = await import("./engine");

const PHONE = "597907523413541";
const SECRET = "test-secret";
type Db = Awaited<ReturnType<typeof openDb>>;
let db: Db;
let businessId: string;

function sign(raw: string, secret = SECRET) {
  return createHmac("sha256", secret).update(raw).digest("hex");
}

function inbound(id: string, text: string, opts: { ts?: number; origin?: string } = {}) {
  return JSON.stringify({
    message: {
      id,
      timestamp: String(Math.floor((opts.ts ?? Date.now()) / 1000)),
      type: "text",
      from: "996551232424",
      text: { body: text },
      kapso: { direction: "inbound", origin: opts.origin ?? "cloud_api" },
    },
    conversation: { contact_name: "Kuba", phone_number: "996551232424" },
    phone_number_id: PHONE,
  });
}

async function deliver(raw: string, event = "whatsapp.message.received", signature = sign(raw)) {
  const r = await receiveWebhook(db, raw, signature, event);
  if (r.status === 200 && r.work) await r.work();
  return r.status;
}

beforeEach(async () => {
  delete process.env.LLM_PROVIDER; // keyword rules: no AI calls in tests
  sent.length = 0;
  db = await openDb({ memory: true });
  const owner = await signUp(db, "owner@shop.kg", "secret123");
  const demo = demoBusiness("shop");
  const row = await replaceBusiness(db, owner, {
    ...demo,
    live: true,
    sheet: { ...demo.sheet, prices: demo.sheet.prices.map((p) => ({ ...p, needs_check: false })) },
  });
  businessId = row.id;
  await connectWhatsApp(db, row.id, PHONE);
  await setWebhook(db, row.id, { id: "wh_1", secret: SECRET });
});

describe("Kapso webhook", () => {
  it("checks signatures", () => {
    expect(signatureValid("{}", sign("{}"), SECRET)).toBe(true);
    expect(signatureValid("{}", sign("{}", "other"), SECRET)).toBe(false);
    expect(signatureValid("{}", null, SECRET)).toBe(false);
    expect(signatureValid("{}", "short", SECRET)).toBe(false);
  });

  it("answers a customer message and saves the chat", async () => {
    expect(await deliver(inbound("wamid.1", "Сколько стоят белые кроссовки?"))).toBe(200);
    expect(sent).toEqual([{ to: "996551232424", body: "Белые кроссовки — 4500 сом." }]);
    const chat = (await loadChat(db, businessId, "wa:996551232424"))!;
    expect(chat.customer).toBe("Kuba");
    expect(chat.is_whatsapp).toBe(true);
    expect(chat.messages.map((m) => m.from)).toEqual(["customer", "bot"]);
  });

  it("refuses a bad signature and an unknown number, and does nothing", async () => {
    const raw = inbound("wamid.2", "Здравствуйте");
    expect(await deliver(raw, "whatsapp.message.received", sign(raw, "wrong"))).toBe(401);
    const other = raw.replace(PHONE, "111");
    expect(await deliver(other, "whatsapp.message.received", sign(other))).toBe(404);
    expect(sent).toEqual([]);
    expect(await loadChat(db, businessId, "wa:996551232424")).toBeNull();
  });

  it("ignores a repeated delivery of the same message", async () => {
    const raw = inbound("wamid.3", "Здравствуйте");
    await deliver(raw);
    await deliver(raw);
    expect(sent).toHaveLength(1);
  });

  it("never answers imported history or messages from before the connection", async () => {
    await deliver(inbound("wamid.4", "Сколько стоят белые кроссовки?", { origin: "history_sync" }));
    await deliver(inbound("wamid.5", "Сколько стоят белые кроссовки?", { ts: Date.now() - 3_600_000 }));
    expect(sent).toEqual([]);
  });

  it("does not answer before the business is live", async () => {
    await updateBusinessData(db, businessId, { live: false });
    await deliver(inbound("wamid.6", "Сколько стоят белые кроссовки?"));
    expect(sent).toEqual([]);
    expect((await loadChat(db, businessId, "wa:996551232424"))!.messages).toHaveLength(1);
  });

  it("a staff reply from the WhatsApp Business app pauses the bot", async () => {
    const echo = JSON.stringify({
      message: {
        id: "wamid.7",
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: "text",
        to: "996551232424",
        text: { body: "Сейчас уточню" },
        kapso: { direction: "outbound", origin: "business_app" },
      },
      phone_number_id: PHONE,
    });
    await deliver(echo, "whatsapp.message.sent");
    const chat = (await loadChat(db, businessId, "wa:996551232424"))!;
    expect(isPaused(chat, Date.now())).toBe(true);
    await deliver(inbound("wamid.8", "Сколько стоят белые кроссовки?"));
    expect(sent).toEqual([]);
  });

  it("our own sent messages (not from the phone) don't pause anything", async () => {
    const own = JSON.stringify({
      message: { id: "wamid.9", timestamp: String(Math.floor(Date.now() / 1000)), type: "text", to: "996551232424", text: { body: "x" }, kapso: { direction: "outbound", origin: "cloud_api" } },
      phone_number_id: PHONE,
    });
    await deliver(own, "whatsapp.message.sent");
    expect(await loadChat(db, businessId, "wa:996551232424")).toBeNull();
  });

  it("handles a batch of messages", async () => {
    const one = JSON.parse(inbound("wamid.10", "Здравствуйте"));
    const two = JSON.parse(inbound("wamid.11", "До скольки работаете?"));
    const raw = JSON.stringify({ type: "whatsapp.message.received", batch: true, data: [one, two] });
    await deliver(raw);
    expect(sent.map((s) => s.body)).toEqual(["Здравствуйте! Чем могу помочь?", "Мы работаем 10:00–20:00."]);
  });
});
