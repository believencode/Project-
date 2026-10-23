import type { Chat, Sheet } from "../types";
import type { Db } from "../db";
import { getBusinessRowById, updateBusinessData, type BusinessRow } from "../repo";
import { listMessages, type KapsoMessage } from "../kapso";
import { llmEnabled } from "../llm";
import { buildSheetWithAI } from "../sheetBuilder";
import { attachSources } from "../sources";

/**
 * Server only. The chats the owner shared when connecting WhatsApp ("Share all
 * chats"): Kapso keeps them as messages marked history_sync. We copy them in as
 * imported chats (never answered, hidden from the inbox), let the AI read them,
 * and add what it finds to the knowledge base as facts the owner still has to check.
 */

/** Enough months of a small business's chats, and small enough for one AI read. */
export const MAX_MESSAGES = 2000;

/** Group shared WhatsApp messages into one imported chat per customer, newest messages kept. */
export function historyChats(messages: KapsoMessage[]): Chat[] {
  const texts = messages
    .filter((m) => m.kapso?.origin === "history_sync" && m.type === "text" && m.text?.body?.trim())
    .sort((a, b) => Number(a.timestamp) - Number(b.timestamp))
    .slice(-MAX_MESSAGES);
  const chats = new Map<string, Chat>();
  for (const m of texts) {
    const outbound = m.kapso?.direction === "outbound";
    const waId = ((outbound ? m.to : m.from) ?? m.kapso?.phone_number ?? "").replace(/\D/g, "");
    if (!waId) continue;
    const chat = chats.get(waId) ?? {
      id: `hist:${waId}`,
      customer: `+${waId}`,
      phone: `+${waId}`,
      messages: [],
      off_topic_count: 0,
      ai_stopped: true,
      paused_until: null,
      needs_person: null,
      imported: true,
    };
    if (!outbound && m.kapso?.contact_name) chat.customer = m.kapso.contact_name;
    chat.messages.push({ id: `h-${m.id}`, from: outbound ? "staff" : "customer", text: m.text!.body.trim(), at: Number(m.timestamp) * 1000, kind: "text" });
    chats.set(waId, chat);
  }
  return [...chats.values()];
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Add what the AI learned to the owner's sheet without touching anything the owner
 * already has: new prices, notes and facts only, all waiting for the owner to check.
 */
export function mergeLearned(current: Sheet, learned: Sheet, tag: string): { sheet: Sheet; added: number } {
  const prices = learned.prices.filter((p) => !current.prices.some((c) => same(c.item, p.item)));
  const availability = learned.availability.filter((n) => !current.availability.some((c) => same(c.text, n.text)));
  const facts = (learned.facts ?? []).filter((f) => !(current.facts ?? []).some((c) => same(c.topic, f.topic) || same(c.text, f.text)));
  const hours = !current.hours.trim() && learned.hours ? learned.hours : "";
  const address = !current.address.trim() && learned.address ? learned.address : "";
  const sheet: Sheet = {
    ...current,
    ...(hours ? { hours, hours_source: learned.hours_source } : {}),
    ...(address ? { address, address_source: learned.address_source } : {}),
    prices: [...current.prices, ...prices.map((p, i) => ({ ...p, id: `${tag}p${i}`, needs_check: true }))],
    availability: [...current.availability, ...availability.map((n, i) => ({ ...n, id: `${tag}a${i}`, needs_check: true }))],
    facts: [...(current.facts ?? []), ...facts.map((f, i) => ({ ...f, id: `${tag}f${i}`, needs_check: true }))],
    top_questions: current.top_questions.length ? current.top_questions : learned.top_questions,
    tone_examples: current.tone_examples.length ? current.tone_examples : learned.tone_examples,
  };
  return { sheet, added: prices.length + availability.length + facts.length + (hours ? 1 : 0) + (address ? 1 : 0) };
}

/** Replace this business's imported WhatsApp chats in a few queries, however many messages. */
async function saveImported(db: Db, businessId: string, chats: Chat[]): Promise<void> {
  await db.tx(async (t) => {
    await t.query("DELETE FROM chats WHERE business_id = $1 AND id LIKE 'hist:%'", [businessId]);
    if (chats.length === 0) return;
    await t.query(
      `INSERT INTO chats (business_id, id, state, last_at)
       SELECT $1, r.id, r.state, r.last_at FROM jsonb_to_recordset($2::jsonb) AS r(id text, state jsonb, last_at bigint)`,
      [businessId, JSON.stringify(chats.map(({ messages, ...state }) => ({ id: state.id, state, last_at: Math.max(...messages.map((m) => m.at)) })))],
    );
    await t.query(
      `INSERT INTO messages (business_id, chat_id, id, at, data)
       SELECT $1, r.chat_id, r.id, r.at, r.data FROM jsonb_to_recordset($2::jsonb) AS r(chat_id text, id text, at bigint, data jsonb)
       ON CONFLICT (business_id, id) DO NOTHING`,
      [businessId, JSON.stringify(chats.flatMap((c) => c.messages.map((m) => ({ chat_id: c.id, id: m.id, at: m.at, data: m }))))],
    );
  });
}

export type ImportResult = { status: "empty" } | { status: "done"; chats: number; added: number };

/**
 * Copy in the shared chats and learn from them. "empty": nothing shared (yet) —
 * WhatsApp can take a few minutes after connecting, or the owner chose not to share.
 */
export async function importHistory(db: Db, row: BusinessRow, now = Date.now()): Promise<ImportResult> {
  const phone = row.kapso_phone_number_id!;
  // Shared chats go back about 6 months; ask a little further to be safe.
  const since = new Date(now - 400 * 24 * 3600_000);
  const [inbound, outbound] = await Promise.all([
    listMessages(phone, { since, direction: "inbound", maxPages: 20 }),
    listMessages(phone, { since, direction: "outbound", maxPages: 20 }),
  ]);
  const chats = historyChats([...inbound, ...outbound]);
  if (chats.length === 0) return { status: "empty" };
  await saveImported(db, row.id, chats);

  // Read the sheet now, not from before the slow part: the owner may have edited it meanwhile.
  const fresh = (await getBusinessRowById(db, row.id)) ?? row;
  let added = 0;
  if (llmEnabled()) {
    const learned = attachSources(await buildSheetWithAI(chats, fresh.data.sheet.type, fresh.data.sheet.name), chats);
    const merged = mergeLearned(fresh.data.sheet, learned, `h${now.toString(36)}`);
    added = merged.added;
    await updateBusinessData(db, row.id, { sheet: merged.sheet, imported_history: true, sheet_built_by: "ai" });
  } else {
    await updateBusinessData(db, row.id, { imported_history: true });
  }
  return { status: "done", chats: chats.length, added };
}
