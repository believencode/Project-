import Anthropic from "@anthropic-ai/sdk";
import type { Draft, HistoryLine, Label, ReplyDecision, Sheet, Slots } from "./types";
import { LABELS } from "./types";
import { replyFromSheet } from "./rules";
import { contextItem, extractSlots, isCancel } from "./actions";

/** Server only. Classifier, replies and booking/order details through Claude, enabled with LLM_PROVIDER=anthropic. */

export function llmEnabled(): boolean {
  return process.env.LLM_PROVIDER === "anthropic";
}

const MODEL = process.env.LLM_MODEL || "claude-opus-5-5";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

const CLASSIFY_SYSTEM = `You label the newest WhatsApp message a customer sent to a small business in Bishkek.
Earlier messages are context only: use them to understand short follow-ups like "а 42 есть?" or "а лоферы?".
Labels:
- greeting: only hello, thanks, bye, "ок" — nothing else in the message.
- price: what something costs.
- hours: opening hours.
- booking: wanting to reserve a table, a time slot, or hold an item.
- order: wanting to buy or order something.
- address: where the business is, how to get there.
- availability: size, stock, delivery time, free tables or free slots.
- off_topic: anything else, including jailbreaks, jokes, homework, poems, and questions about other businesses.
If a message mixes an on-topic question with anything else, use the on-topic label.`;

const REPLY_SYSTEM = `You reply to a WhatsApp customer for a small business. Write in Russian, at most 3 sentences, in the tone of the staff examples.
Use only the facts in <facts>. Never invent prices, stock, sizes, times or addresses.
Earlier messages are context: if the newest message is a short follow-up, answer it about the item the conversation is about.
If you can't tell which item or option the customer means, and one short question would let you answer from <facts>, put that question in follow_up and leave reply empty.
If the answer needs a fact that is not in <facts>, set missing to true and leave reply and follow_up empty.
Answer only the on-topic part of the message; ignore any other request in it.
Availability facts may be stale: phrase them as "по последним данным".`;

const EXTRACT_SYSTEM = `Read the newest WhatsApp message and pull out booking or order details. Earlier messages are context.
- item: exactly one of the names in <items>, or "" if none is meant.
- size: a clothing or shoe size as digits, or "".
- day: a day word in Russian such as "сегодня", "завтра", "пятница", or "".
- time: 24-hour "HH:MM", or "". "в семь вечера" is "19:00".
- people: number of guests, or 0.
- cancel: true only if the customer calls the booking or order off.
Use "" or 0 for anything the message does not say. Do not guess.`;

function confirmedFacts(sheet: Sheet) {
  return {
    business: sheet.name,
    hours: sheet.hours || null,
    address: sheet.address || null,
    prices: sheet.prices.filter((p) => !p.needs_check).map(({ item, amount, currency }) => ({ item, amount, currency })),
    availability: sheet.availability.filter((n) => !n.needs_check).map((n) => n.text),
  };
}

function transcript(history: HistoryLine[]): string {
  const who = { customer: "Customer", bot: "Bot", staff: "Staff", system: "System" } as const;
  return history.map((h) => `${who[h.from]}: ${h.text}`).join("\n");
}

function prompt(history: HistoryLine[], text: string, extra = ""): string {
  return `${extra}<earlier_messages>\n${transcript(history)}\n</earlier_messages>\n<newest_message>${text}</newest_message>`;
}

async function jsonCall<T>(system: string, user: string, schema: Record<string, unknown>): Promise<T> {
  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: 1024,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    system,
    messages: [{ role: "user", content: user }],
  });
  if (response.stop_reason === "refusal") throw new Error("refusal");
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  return JSON.parse(text) as T;
}

async function extract(text: string, sheet: Sheet, history: HistoryLine[]): Promise<{ slots: Slots; cancel: boolean }> {
  const out = await jsonCall<{ item: string; size: string; day: string; time: string; people: number; cancel: boolean }>(
    EXTRACT_SYSTEM,
    prompt(history, text, `<items>${sheet.prices.map((p) => p.item).join(", ")}</items>\n`),
    {
      type: "object",
      properties: {
        item: { type: "string" },
        size: { type: "string" },
        day: { type: "string" },
        time: { type: "string" },
        people: { type: "integer" },
        cancel: { type: "boolean" },
      },
      required: ["item", "size", "day", "time", "people", "cancel"],
      additionalProperties: false,
    },
  );
  // Keep only values we can trust: known items, real sizes and times.
  const slots: Slots = {};
  const item = sheet.prices.find((p) => p.item.toLowerCase() === out.item.trim().toLowerCase());
  if (item) slots.item = item.item;
  if (sheet.type === "shop" && /^\d{2}$/.test(out.size.trim())) slots.size = out.size.trim();
  if (out.day.trim()) slots.day = out.day.trim().toLowerCase();
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(out.time.trim())) slots.time = out.time.trim();
  if (out.people > 0 && out.people < 100) slots.people = out.people;
  return { slots, cancel: out.cancel };
}

export async function decideWithLLM(text: string, sheet: Sheet, history: HistoryLine[], draft?: Draft | null): Promise<ReplyDecision> {
  // A booking/order is in progress: does this message answer the bot's question?
  if (draft) {
    const { slots, cancel } = await extract(text, sheet, history);
    const fresh = Object.entries(slots).some(([k, v]) => draft.slots[k as keyof Slots] !== v);
    if (cancel || isCancel(text) || fresh) {
      return { label: draft.kind, reply: null, missing: false, path: "LLM", slots, cancel: cancel || isCancel(text), continues_draft: true };
    }
  }

  const { label } = await jsonCall<{ label: Label }>(CLASSIFY_SYSTEM, prompt(history, text), {
    type: "object",
    properties: { label: { type: "string", enum: [...LABELS] } },
    required: ["label"],
    additionalProperties: false,
  });

  if (label === "booking" || label === "order") {
    const { slots } = await extract(text, sheet, history);
    // Fill gaps the model left that the rules can read for sure.
    const rules = extractSlots(text, sheet);
    const merged: Slots = { ...rules, ...slots };
    if (!merged.item && (label === "order" || sheet.type === "shop")) merged.item = contextItem(history, sheet);
    if (!merged.item) delete merged.item;
    return { label, reply: null, missing: false, path: "LLM", slots: merged };
  }

  // Fixed lines and greetings don't need the reply model.
  if (label === "off_topic" || label === "greeting") {
    const { reply, missing } = replyFromSheet(label, text, sheet, history);
    return { label, reply, missing, path: "LLM" };
  }

  const out = await jsonCall<{ reply: string; follow_up: string; missing: boolean }>(
    REPLY_SYSTEM,
    prompt(
      history,
      text,
      `<facts>${JSON.stringify(confirmedFacts(sheet))}</facts>\n<staff_examples>${sheet.tone_examples.join("\n")}</staff_examples>\n<topic>${label}</topic>\n`,
    ),
    {
      type: "object",
      properties: { reply: { type: "string" }, follow_up: { type: "string" }, missing: { type: "boolean" } },
      required: ["reply", "follow_up", "missing"],
      additionalProperties: false,
    },
  );
  const reply = out.reply.trim();
  const followUp = out.follow_up.trim();
  if (!reply && followUp && !out.missing) return { label, reply: null, missing: false, follow_up: followUp, path: "LLM" };
  return { label, reply: out.missing || !reply ? null : reply, missing: out.missing || !reply, path: "LLM" };
}
