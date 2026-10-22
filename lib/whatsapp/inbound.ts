import type { Chat } from "../types";
import type { Db } from "../db";
import { loadChat, saveChat, seenWaMessage, type BusinessRow } from "../repo";
import { receiveUnclassified, staffReply } from "../engine";
import { runTurn } from "../turn";
import { withLock } from "../locks";
import type { KapsoMessage } from "../kapso";
import { deliverNew } from "./outbound";
import { learnFromStaff } from "../learn";

/**
 * Server only. What happens with one WhatsApp message, whether it arrived by
 * webhook (production) or by polling (local development).
 */

/** Never answer imported history or anything older than the connection. */
export function isLive(row: BusinessRow, m: KapsoMessage): boolean {
  const connectedAt = row.wa_connected_at ? new Date(row.wa_connected_at).getTime() : Date.now();
  return m.kapso?.origin !== "history_sync" && Number(m.timestamp) * 1000 >= connectedAt - 5_000;
}

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

export async function handleInbound(db: Db, row: BusinessRow, m: KapsoMessage) {
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
    const delivered = await deliverNew(db, row, before, after, waId);
    const label = after.messages.find((x) => x.id === customerMsg?.id)?.label ?? (row.data.live ? "not classified" : "not live");
    console.log(`WhatsApp ← ${before.phone} «${kind === "text" ? text : `[${m.type}]`}» [${label}]`);
    for (const x of delivered.chat.messages.slice(before.messages.length).filter((x) => x.from === "bot")) {
      console.log(`WhatsApp → ${before.phone} «${x.text}»${x.delivery === "failed" ? " (NOT DELIVERED)" : ""}`);
    }
    if (delivered.chat.needs_person && !before.needs_person) console.log(`WhatsApp ! ${before.phone} needs a person: ${delivered.chat.needs_person.reason}`);
    await saveChat(db, row.id, delivered.chat, {
      waId,
      waIds: { ...delivered.waIds, ...(customerMsg ? { [customerMsg.id]: m.id } : {}) },
    });
  });
}

export async function handleStaffEcho(db: Db, row: BusinessRow, m: KapsoMessage) {
  const waId = m.to!;
  const chatId = `wa:${waId}`;
  await withLock(`${row.id}:${chatId}`, async () => {
    if (await seenWaMessage(db, m.id)) return;
    const before = (await loadChat(db, row.id, chatId)) ?? newWhatsAppChat(waId);
    const after = staffReply(before, m.text?.body ?? "", Number(m.timestamp) * 1000, "echo");
    await saveChat(db, row.id, after, { waId, waIds: { [after.messages[after.messages.length - 2].id]: m.id } });
    console.log(`WhatsApp ⏸ staff replied to ${before.phone} from the phone — bot paused 30 min in that chat`);
  });
  // Did that reply answer a question the bot couldn't? Then propose it as a fact.
  await learnFromStaff(db, row.id, chatId);
}

