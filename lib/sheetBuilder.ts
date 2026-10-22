import type { BusinessType, Chat, Sheet } from "./types";
import { ALLOWED_TOPICS } from "./copy";
import { numbersIn } from "./guard";
import { mentions } from "./text";
import { jsonCall } from "./llm";

/**
 * Server only. The AI reads the imported one-to-one chats and drafts the
 * knowledge sheet. Every fact it returns is checked against the chats, and
 * all prices and stock notes start as "check this" until the owner confirms.
 */

const SYSTEM = `You read a small business's WhatsApp chats with customers and pull out the facts its staff gave.
Only use what staff actually wrote. Do not guess or fill gaps — leave a field empty if the chats don't say it.
- hours: opening hours as staff stated them, e.g. "10:00–20:00", or "".
- address: as staff stated it, or "".
- prices: each product or service the business sells, with the price staff quoted, in сом. Not delivery or other fees: those go in facts. Use the item name in Russian as customers would say it.
  details: what staff said about the item that doesn't change often (material, colours, what's included), or "".
- availability: short notes on stock, sizes, free tables or slots, e.g. "Белые кроссовки: размеры 40–43". Not one customer's order or hold.
- facts: other things staff told customers about the business: delivery, payment, returns, warranty, parking, rules.
  topic is 1–3 words in Russian ("Доставка"); text is one short sentence in Russian ("Доставка по Бишкеку — 200 сом.").
- top_questions: up to 5 short labels in Russian for what customers ask most.
- tone_examples: 2 short staff replies copied exactly, that show how staff talk to customers.`;

interface Extracted {
  hours: string;
  address: string;
  prices: { item: string; amount: number; details: string }[];
  availability: string[];
  facts: { topic: string; text: string }[];
  top_questions: string[];
  tone_examples: string[];
}

function transcript(chats: Chat[]): string {
  return chats
    .filter((c) => !c.is_test)
    .map(
      (c, i) =>
        `<chat n="${i + 1}">\n${c.messages
          .filter((m) => m.from === "customer" || m.from === "staff")
          .map((m) => `${m.from === "staff" ? "Staff" : "Customer"}: ${m.kind === "voice" ? "[voice message]" : m.text}`)
          .join("\n")}\n</chat>`,
    )
    .join("\n");
}

export async function buildSheetWithAI(chats: Chat[], type: BusinessType, name: string): Promise<Sheet> {
  const out = await jsonCall<Extracted>(SYSTEM, transcript(chats), {
    type: "object",
    properties: {
      hours: { type: "string" },
      address: { type: "string" },
      prices: {
        type: "array",
        items: {
          type: "object",
          properties: { item: { type: "string" }, amount: { type: "number" }, details: { type: "string" } },
          required: ["item", "amount", "details"],
          additionalProperties: false,
        },
      },
      availability: { type: "array", items: { type: "string" } },
      facts: {
        type: "array",
        items: {
          type: "object",
          properties: { topic: { type: "string" }, text: { type: "string" } },
          required: ["topic", "text"],
          additionalProperties: false,
        },
      },
      top_questions: { type: "array", items: { type: "string" } },
      tone_examples: { type: "array", items: { type: "string" } },
    },
    required: ["hours", "address", "prices", "availability", "facts", "top_questions", "tone_examples"],
    additionalProperties: false,
  });

  // Keep only facts whose numbers really appear in the chats.
  const said = new Set(chats.flatMap((c) => c.messages.flatMap((m) => numbersIn(m.text))));
  const backedByChats = (text: string) => numbersIn(text).every((n) => said.has(n));
  const staffLines = chats.flatMap((c) => c.messages.filter((m) => m.from === "staff").map((m) => m.text.trim()));

  const facts = (out.facts ?? []).filter((f) => f.text.trim() && backedByChats(f.text)).slice(0, 15);
  // A fee that is also a fact ("Доставка по Бишкеку — 200") lives in the facts only, so it can't disagree with itself.
  const isFact = (item: string) => facts.some((f) => f.topic.trim() && mentions(item, f.topic));

  return {
    name,
    type,
    language: "both",
    hours: backedByChats(out.hours) ? out.hours.trim() : "",
    address: backedByChats(out.address) ? out.address.trim() : "",
    prices: out.prices
      .filter((p) => p.item.trim() && p.amount > 0 && said.has(p.amount) && !isFact(p.item))
      .slice(0, 20)
      .map((p, i) => ({
        id: `p${i}`,
        item: p.item.trim(),
        amount: p.amount,
        currency: "сом",
        needs_check: true,
        ...(p.details?.trim() && backedByChats(p.details) ? { details: p.details.trim() } : {}),
      })),
    availability: out.availability
      .filter((t) => t.trim() && backedByChats(t))
      .slice(0, 10)
      .map((text, i) => ({ id: `a${i}`, text: text.trim(), needs_check: true })),
    // Like prices, every fact waits for the owner to confirm it.
    facts: facts.map((f, i) => ({ id: `f${i}`, topic: f.topic.trim() || "Другое", text: f.text.trim(), needs_check: true })),
    top_questions: out.top_questions.map((q) => q.trim()).filter(Boolean).slice(0, 5),
    // Tone examples must be real staff replies, not something the model made up.
    tone_examples: out.tone_examples.map((t) => t.trim()).filter((t) => staffLines.includes(t)).slice(0, 2),
    allowed_topics: ALLOWED_TOPICS,
  };
}
