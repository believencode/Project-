import type { Chat } from "../types";
import type { Db } from "../db";
import type { BusinessRow } from "../repo";
import { chatWaId } from "../repo";
import { KapsoError, sendText } from "../kapso";

/**
 * Server only. After a change to a WhatsApp chat, send what's new to the
 * customer: bot replies, and staff replies typed in the inbox. Returns the
 * WhatsApp ids of what was sent, and marks anything that failed.
 */
export async function deliverNew(
  db: Db,
  row: BusinessRow,
  before: Chat,
  after: Chat,
): Promise<{ chat: Chat; waIds: Record<string, string> }> {
  const waIds: Record<string, string> = {};
  if (!row.kapso_phone_number_id) return { chat: after, waIds };
  const to = await chatWaId(db, row.id, after.id);
  if (!to) return { chat: after, waIds };

  const known = new Set(before.messages.map((m) => m.id));
  const messages = [...after.messages];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (known.has(m.id) || (m.from !== "bot" && m.from !== "staff") || !m.text.trim()) continue;
    try {
      const id = await sendText(row.kapso_phone_number_id, to, m.text);
      if (id) waIds[m.id] = id;
    } catch (err) {
      console.error(`WhatsApp send failed for ${after.id}:`, err instanceof KapsoError ? err.message : err);
      messages[i] = { ...m, text: m.text, delivery: "failed" };
    }
  }
  return { chat: { ...after, messages }, waIds };
}
