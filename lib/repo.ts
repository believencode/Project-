import type { Business, Chat, Message } from "./types";
import type { Db } from "./db";

/**
 * Server only. Loads and saves businesses, chats and messages. The rest of the
 * app keeps working with the same Business and Chat objects it always has.
 */

type BusinessData = Omit<Business, "chats">;
type ChatState = Omit<Chat, "messages">;

export interface BusinessRow {
  id: string;
  owner_id: string;
  data: BusinessData;
  kapso_phone_number_id: string | null;
  wa_connected_at: string | null;
  wa_since: string | null;
}

function splitBusiness(b: Business): BusinessData {
  const { chats: _chats, ...data } = b;
  return data;
}

function splitChat(c: Chat): ChatState {
  const { messages: _messages, ...state } = c;
  return state;
}

const lastAt = (c: Chat) => c.messages.reduce((t, m) => Math.max(t, m.at), 0);

export async function getBusinessRow(db: Db, ownerId: string): Promise<BusinessRow | null> {
  const [row] = await db.query<BusinessRow>("SELECT * FROM businesses WHERE owner_id = $1", [ownerId]);
  return row ?? null;
}

export async function getBusinessRowById(db: Db, id: string): Promise<BusinessRow | null> {
  const [row] = await db.query<BusinessRow>("SELECT * FROM businesses WHERE id = $1", [id]);
  return row ?? null;
}

/** The whole business with every chat and message, as the web app uses it. */
export async function loadBusiness(db: Db, row: BusinessRow): Promise<Business> {
  const chats = await db.query<{ id: string; state: ChatState }>(
    "SELECT id, state FROM chats WHERE business_id = $1 ORDER BY last_at DESC",
    [row.id],
  );
  const messages = await db.query<{ chat_id: string; data: Message }>(
    "SELECT chat_id, data FROM messages WHERE business_id = $1 ORDER BY at, id",
    [row.id],
  );
  const byChat = new Map<string, Message[]>();
  for (const m of messages) byChat.set(m.chat_id, [...(byChat.get(m.chat_id) ?? []), m.data]);
  return { ...row.data, id: row.id, chats: chats.map((c) => ({ ...c.state, messages: byChat.get(c.id) ?? [] })) };
}

/** Create or replace the owner's business (setup, demo). Replaces all chats. */
export async function replaceBusiness(db: Db, ownerId: string, b: Business): Promise<BusinessRow> {
  return db.tx(async (t) => {
    const existing = await getBusinessRow(t, ownerId);
    const id = existing?.id ?? b.id;
    if (existing) {
      await t.query("DELETE FROM chats WHERE business_id = $1", [id]);
      await t.query("UPDATE businesses SET data = $2, updated_at = now() WHERE id = $1", [id, splitBusiness({ ...b, id })]);
    } else {
      await t.query("INSERT INTO businesses (id, owner_id, data) VALUES ($1, $2, $3)", [id, ownerId, splitBusiness({ ...b, id })]);
    }
    for (const c of b.chats) await saveChat(t, id, c);
    return (await getBusinessRow(t, ownerId))!;
  });
}

/** Change the sheet or setup flags; chats are untouched. */
export async function updateBusinessData(db: Db, id: string, patch: Partial<BusinessData>): Promise<void> {
  await db.query("UPDATE businesses SET data = data || $2::jsonb, updated_at = now() WHERE id = $1", [id, JSON.stringify(patch)]);
}

export async function deleteBusiness(db: Db, ownerId: string): Promise<void> {
  await db.query("DELETE FROM businesses WHERE owner_id = $1", [ownerId]);
}

export async function loadChat(db: Db, businessId: string, chatId: string): Promise<Chat | null> {
  const [c] = await db.query<{ state: ChatState }>("SELECT state FROM chats WHERE business_id = $1 AND id = $2", [businessId, chatId]);
  if (!c) return null;
  const messages = await db.query<{ data: Message }>(
    "SELECT data FROM messages WHERE business_id = $1 AND chat_id = $2 ORDER BY at, id",
    [businessId, chatId],
  );
  return { ...c.state, messages: messages.map((m) => m.data) };
}

/**
 * Save a chat and its messages. `waIds` links our message ids to WhatsApp
 * message ids (incoming messages, and replies Kapso sent).
 */
export async function saveChat(db: Db, businessId: string, chat: Chat, opts: { waId?: string; waIds?: Record<string, string> } = {}): Promise<void> {
  await db.query(
    `INSERT INTO chats (business_id, id, wa_id, state, last_at) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (business_id, id) DO UPDATE SET state = EXCLUDED.state, last_at = EXCLUDED.last_at,
       wa_id = COALESCE(EXCLUDED.wa_id, chats.wa_id)`,
    [businessId, chat.id, opts.waId ?? null, splitChat(chat), lastAt(chat)],
  );
  for (const m of chat.messages) {
    await db.query(
      `INSERT INTO messages (business_id, chat_id, id, at, data, wa_message_id) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (business_id, id) DO UPDATE SET data = EXCLUDED.data,
         wa_message_id = COALESCE(EXCLUDED.wa_message_id, messages.wa_message_id)`,
      [businessId, chat.id, m.id, m.at, m, opts.waIds?.[m.id] ?? null],
    );
  }
}

/** Remove imported chats (Settings → Delete imported chats). The test chat stays. */
export async function deleteImportedChats(db: Db, businessId: string): Promise<void> {
  await db.query("DELETE FROM chats WHERE business_id = $1 AND NOT COALESCE((state->>'is_test')::boolean, false)", [businessId]);
  await updateBusinessData(db, businessId, { imported_history: false });
}

/** Has this WhatsApp message already been handled? */
export async function seenWaMessage(db: Db, waMessageId: string): Promise<boolean> {
  const rows = await db.query("SELECT 1 FROM messages WHERE wa_message_id = $1", [waMessageId]);
  return rows.length > 0;
}

export async function chatWaId(db: Db, businessId: string, chatId: string): Promise<string | null> {
  const [row] = await db.query<{ wa_id: string | null }>("SELECT wa_id FROM chats WHERE business_id = $1 AND id = $2", [businessId, chatId]);
  return row?.wa_id ?? null;
}

export async function connectWhatsApp(db: Db, businessId: string, phoneNumberId: string | null): Promise<void> {
  await db.query(
    `UPDATE businesses SET kapso_phone_number_id = $2,
       wa_connected_at = CASE WHEN $2::text IS NULL THEN NULL ELSE now() END,
       wa_since = CASE WHEN $2::text IS NULL THEN NULL ELSE now() END
     WHERE id = $1`,
    [businessId, phoneNumberId],
  );
}

export async function setWaSince(db: Db, businessId: string, since: Date): Promise<void> {
  await db.query("UPDATE businesses SET wa_since = $2 WHERE id = $1", [businessId, since.toISOString()]);
}

export async function businessesOnWhatsApp(db: Db): Promise<BusinessRow[]> {
  return db.query<BusinessRow>("SELECT * FROM businesses WHERE kapso_phone_number_id IS NOT NULL");
}
