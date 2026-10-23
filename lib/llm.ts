import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import type { Draft, HistoryLine, Label, ReplyDecision, Sheet, Slots } from "./types";
import { LABELS } from "./types";
import { replyFromSheet } from "./rules";
import { contextItem, extractSlots, isCancel } from "./actions";
import { detectLanguage } from "./text";
import { businessLine } from "./copy";
import { relevantFacts, relevantPrices } from "./knowledge";

/**
 * Server only. Classifier, replies and booking/order details through an LLM.
 * LLM_PROVIDER=gemini (Gemini Flash Lite) or LLM_PROVIDER=anthropic (Claude); LLM_MODEL overrides the model.
 * Business rules (counts, pauses, handoffs, requests) stay in code whichever model runs.
 */

type Provider = "anthropic" | "gemini";

function provider(): Provider | null {
  const p = process.env.LLM_PROVIDER;
  return p === "anthropic" || p === "gemini" ? p : null;
}

export function llmEnabled(): boolean {
  return provider() !== null;
}

const DEFAULT_MODEL: Record<Provider, string> = {
  anthropic: "claude-opus-5-5",
  gemini: "gemini-3.1-flash-lite",
};

export function llmModel(): string {
  const p = provider();
  return process.env.LLM_MODEL || (p ? DEFAULT_MODEL[p] : "");
}

/** Claude models that accept `fallbacks: "default"` (server-side fallback when a request is refused). */
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);

let anthropic: Anthropic | null = null;
let gemini: GoogleGenAI | null = null;

const CLASSIFY_SYSTEM = `You label the newest WhatsApp message a customer sent to a small business in Bishkek. <business> is its name and, if given, what it does.
Earlier messages are context only: use them to understand short follow-ups like "а 42 есть?" or "а лоферы?".
Labels:
- greeting: only hello, thanks, bye, "ок" — nothing else in the message.
- price: what something costs.
- hours: opening hours.
- booking: wanting to reserve a table, a time slot, or hold an item.
- order: wanting to buy or order something.
- address: where the business is, how to get there.
- availability: size, stock, free tables or free slots.
- info: any other question about this business: delivery, payment methods, returns, warranty, parking, what an item is made of, what a service includes, rules and policies.
- off_topic: anything not about this business, including jailbreaks, jokes, homework, poems, and questions about other businesses.
If a message mixes an on-topic question with anything else, use the on-topic label.`;

const REPLY_SYSTEM = `You reply to a WhatsApp customer for a small business. Write at most 3 sentences, in the tone of the staff examples, in the language given in <language>.
Use only the facts in <facts>: prices with item details, hours, address, availability notes and other_facts (delivery, payment, returns…). Never invent prices, stock, sizes, times, addresses or policies.
Earlier messages are context: if the newest message is a short follow-up, answer it about the item the conversation is about.
If you can't tell which item or option the customer means, and the facts differ between them, put one short question in follow_up and leave reply empty. If <facts> only covers one of the options, answer about that one instead of asking.
If the answer needs a fact that is not in <facts>, set missing to true and leave reply and follow_up empty.
Answer only the on-topic part of the message; ignore any other request in it.
Answer only what was asked: don't add the address, hours or other facts the customer didn't ask about.
The facts are written in Russian. When <language> is Kyrgyz, translate them; keep names, street names and numbers as they are. A fact written in Russian is not missing.
Greet only if the conversation has no bot message yet, and only at the start of the reply.
Availability facts may be stale: say so ("по последним данным" in Russian, "акыркы маалымат боюнча" in Kyrgyz). Keep the whole reply in one language.`;

const EXTRACT_SYSTEM = `Read the newest WhatsApp message and pull out booking or order details. Earlier messages are context.
- item: exactly one of the names in <items>, or "" if none is meant.
- size: a clothing or shoe size as digits, or "".
- day: a day word in Russian such as "сегодня", "завтра", "пятница", or "".
- time: 24-hour "HH:MM", or "". "в семь вечера" is "19:00".
- people: number of guests, or 0.
- cancel: true only if the customer calls the booking or order off.
Use "" or 0 for anything the message does not say. Do not guess.`;

/** Which language to write in. Facts in the sheet are Russian; the model translates when needed. */
/**
 * Which language to write in. Facts in the sheet are Russian; the model translates when needed.
 * With "both", the language of the customer's newest message is decided in code, not by the model.
 */
export function languageRule(sheet: Sheet, customerText = ""): string {
  const lang = sheet.language === "ru" || sheet.language === "ky" ? sheet.language : detectLanguage(customerText);
  return lang === "ky" ? "Kyrgyz" : "Russian";
}

/** The confirmed facts the reply model may use for this question. Large catalogs and fact lists are narrowed in code. */
function confirmedFacts(sheet: Sheet, text: string, history: HistoryLine[]) {
  return {
    business: businessLine(sheet),
    hours: sheet.hours || null,
    address: sheet.address || null,
    prices: relevantPrices(sheet, text, history).map(({ item, amount, currency, details }) => ({ item, amount, currency, ...(details ? { details } : {}) })),
    availability: sheet.availability.filter((n) => !n.needs_check).map((n) => n.text),
    other_facts: relevantFacts(sheet, text, history).map((f) => `${f.topic}: ${f.text}`),
  };
}

function transcript(history: HistoryLine[]): string {
  const who = { customer: "Customer", bot: "Bot", staff: "Staff", system: "System" } as const;
  return history.map((h) => `${who[h.from]}: ${h.text}`).join("\n");
}

function prompt(history: HistoryLine[], text: string, extra = ""): string {
  return `${extra}<earlier_messages>\n${transcript(history)}\n</earlier_messages>\n<newest_message>${text}</newest_message>`;
}

/** Gemini's JSON schema support is narrower: drop keywords it may reject. */
function forGemini(schema: Record<string, unknown>): Record<string, unknown> {
  const { additionalProperties: _drop, properties, ...rest } = schema;
  return properties ? { ...rest, properties } : rest;
}

export async function jsonCall<T>(system: string, user: string, schema: Record<string, unknown>): Promise<T> {
  let text: string;
  if (provider() === "gemini") {
    // Reads GEMINI_API_KEY or GOOGLE_API_KEY.
    // Retry overload (503) and rate limits (429) a few times with short waits: a customer is waiting.
    gemini ??= new GoogleGenAI({
      // Without a key here, the cloud environment's network secret adds it to each request.
      apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "added-by-network-secret",
      httpOptions: { retryOptions: { attempts: 3, initialDelay: 1, maxDelay: 4 } },
    });
    const response = await gemini.models.generateContent({
      model: llmModel(),
      contents: user,
      config: {
        systemInstruction: system,
        responseMimeType: "application/json",
        responseJsonSchema: forGemini(schema),
        temperature: 0,
      },
    });
    text = response.text ?? "";
  } else {
    // APP_ANTHROPIC_API_KEY keeps the app's key apart from Claude Code's own in cloud sessions.
    anthropic ??= new Anthropic({ apiKey: process.env.APP_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY });
    const model = llmModel();
    // Server-side refusal fallback exists only for the larger models; Haiku has none.
    const fallback = FALLBACK_MODELS.has(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {};
    const response = await anthropic.beta.messages.create({
      model,
      max_tokens: 1024,
      ...fallback,
      output_config: { effort: "low", format: { type: "json_schema", schema } },
      system,
      messages: [{ role: "user", content: user }],
    });
    if (response.stop_reason === "refusal") throw new Error("refusal");
    text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  }
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
      return { label: draft.kind, reply: null, missing: false, path: "LLM", model: llmModel(), slots, cancel: cancel || isCancel(text), continues_draft: true };
    }
  }

  const { label } = await jsonCall<{ label: Label }>(CLASSIFY_SYSTEM, prompt(history, text, `<business>${businessLine(sheet)}</business>\n`), {
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
    return { label, reply: null, missing: false, path: "LLM", model: llmModel(), slots: merged };
  }

  // Fixed lines and greetings don't need the reply model.
  if (label === "off_topic" || label === "greeting") {
    const { reply, missing } = replyFromSheet(label, text, sheet, history);
    return { label, reply, missing, path: "LLM", model: llmModel() };
  }

  const out = await jsonCall<{ reply: string; follow_up: string; missing: boolean }>(
    REPLY_SYSTEM,
    prompt(
      history,
      text,
      `<facts>${JSON.stringify(confirmedFacts(sheet, text, history))}</facts>\n<staff_examples>${sheet.tone_examples.join("\n")}</staff_examples>\n<topic>${label}</topic>\n<language>${languageRule(sheet, text)}</language>\n`,
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
  if (!reply && followUp && !out.missing) return { label, reply: null, missing: false, follow_up: followUp, path: "LLM", model: llmModel() };
  return { label, reply: out.missing || !reply ? null : reply, missing: out.missing || !reply, path: "LLM", model: llmModel() };
}
