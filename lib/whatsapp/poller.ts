import type { Chat } from "../types";
import { getDb, type Db } from "../db";
import {
  businessesOnWhatsApp,
  getBusinessRowById,
  loadChat,
  saveChat,
  seenWaMessage,
  setWaSince,
  type BusinessRow,
} from "../repo";
import { receiveUnclassified, staffReply } from "../engine";
import { runTurn } from "../turn";
import { withLock } from "../locks";
import { KapsoError, listMessages, type KapsoMessage } from "../kapso";
import { deliverNew } from "./outbound";

/**
 * Server only. Every few seconds, asks Kapso for new WhatsApp messages for each
 * connected business, answers through the bot, and saves everything to the
 * database the web app reads. Staff replies from the WhatsApp Business app
 * pause the bot. Production will receive Kapso webhooks instead of polling.
 */

const POLL_MS = 3000;
const KIND: Record<string, Chat["messages"][number]["kind"]> = { audio: "voice", voice: "voice", image: "photo", sticker: "photo" };

function newWhatsAppChat(waId: string, name?: string): Chat {
  return {
    id: `wa:${waId}`,
    customer: name || `+${waId}`,
    phone: `+${waId}`,
    messages: [],
    off_topic_count: 0,
    ai_stopped: false,
    paused_until: null,
    needs_person: null,
    is_whatsapp: true,
  };
}

async function handleInbound(db: Db, row: BusinessRow, m: KapsoMessage) {
  const waId = m.from!;
  const chatId = `wa:${waId}`;
  await withLock(`${row.id}:${chatId}`, async () => {
    if (await seenWaMessage(db, m.id)) return;
    const before = (await loadChat(db, row.id, chatId)) ?? newWhatsAppChat(waId, m.kapso?.contact_name);
    const text = m.text?.body ?? "";
    const kind = m.type === "text" ? "text" : (KIND[m.type] ?? "photo");
    const at = Math.max(Number(m.timestamp) * 1000, Date.now());
    // Not live yet: keep the message for staff, don't answer.
    const after = row.data.live ? (await runTurn(before, row.data.sheet, text, kind, at)).chat : receiveUnclassified(before, text, kind, at);
    const customerMsg = after.messages.slice(before.messages.length).find((x) => x.from === "customer");
    const delivered = await deliverNew(db, row, { ...before, messages: after.messages.slice(0, before.messages.length) }, after);
    await saveChat(db, row.id, delivered.chat, {
      waId,
      waIds: { ...delivered.waIds, ...(customerMsg ? { [customerMsg.id]: m.id } : {}) },
    });
  });
}

async function handleStaffEcho(db: Db, row: BusinessRow, m: KapsoMessage) {
  const waId = m.to!;
  const chatId = `wa:${waId}`;
  await withLock(`${row.id}:${chatId}`, async () => {
    if (await seenWaMessage(db, m.id)) return;
    const before = (await loadChat(db, row.id, chatId)) ?? newWhatsAppChat(waId);
    const after = staffReply(before, m.text?.body ?? "", Number(m.timestamp) * 1000, "echo");
    await saveChat(db, row.id, after, { waId, waIds: { [after.messages[after.messages.length - 2].id]: m.id } });
  });
}

async function pollBusiness(db: Db, row: BusinessRow) {
  const phone = row.kapso_phone_number_id!;
  const since = new Date(row.wa_since ?? row.wa_connected_at ?? Date.now());
  const connectedAt = Date.parse(row.wa_connected_at ?? new Date().toISOString());
  const [inbound, outbound] = await Promise.all([
    listMessages(phone, { since, direction: "inbound" }),
    listMessages(phone, { since, direction: "outbound" }),
  ]);
  // Never answer imported history or anything older than the connection.
  const live = (m: KapsoMessage) => m.kapso?.origin !== "history_sync" && Number(m.timestamp) * 1000 >= connectedAt - 5_000;
  const fresh = [...inbound, ...outbound.filter((m) => m.kapso?.origin === "business_app")]
    .filter(live)
    .sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
  for (const m of fresh) {
    try {
      if (m.kapso?.direction === "outbound") await handleStaffEcho(db, row, m);
      else await handleInbound(db, row, m);
    } catch (err) {
      console.error(`WhatsApp message ${m.id} failed:`, err);
    }
  }
  const newest = [...inbound, ...outbound].reduce((t, m) => Math.max(t, Number(m.timestamp) * 1000), since.getTime());
  // A 60s overlap: Kapso may list a message a moment after its timestamp; duplicates are skipped.
  await setWaSince(db, row.id, new Date(Math.max(since.getTime(), newest - 60_000)));
}

async function pollAll() {
  const db = await getDb();
  for (const r of await businessesOnWhatsApp(db)) {
    // Re-read so sheet changes made in the web app apply immediately.
    const row = await getBusinessRowById(db, r.id);
    if (!row?.kapso_phone_number_id) continue;
    try {
      await pollBusiness(db, row);
    } catch (err) {
      console.error(`WhatsApp poll for ${row.id} failed:`, err instanceof KapsoError ? err.message : err);
    }
  }
}

const g = globalThis as unknown as { __waPoller?: boolean };

export function startWhatsAppPoller() {
  if (g.__waPoller || !process.env.KAPSO_API_KEY || process.env.KAPSO_POLL === "0") return;
  g.__waPoller = true;
  console.log("WhatsApp: checking Kapso for new messages every 3s");
  const tick = async () => {
    await pollAll().catch((err) => console.error("WhatsApp poll failed:", err));
    setTimeout(tick, POLL_MS);
  };
  void tick();
}
