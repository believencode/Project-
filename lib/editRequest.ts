import type { Sheet } from "./types";
import type { EditOp } from "./edits";
import { jsonCall } from "./llm";

/** Server only. Turn the owner's change request into edit operations. */

const SYSTEM = `A business owner is correcting the facts their WhatsApp bot answers from. Turn their request into operations.
Operations:
- set_price: item and amount in сом (changes an existing price or adds a new one).
- remove_price: item.
- set_hours: text, the full new opening hours, e.g. "09:00–23:00".
- set_address: text, the full new address.
- set_availability: item it's about and text, the full new stock note, e.g. "Белые кроссовки: размеры 39–44".
- remove_availability: item.
- set_details: item and text, the full new details of an item that don't change often (material, colours, what's included).
- set_fact: topic (1–3 words, e.g. "Доставка") and text, one short sentence, for anything else: delivery, payment, returns, parking, rules. Replaces the fact on the same topic.
- remove_fact: topic.
Delivery, payment and other policies are facts (set_fact) even when they cost money, unless <current_facts> lists them as prices.
Use item names and topics from <current_facts> when the owner means an existing item. Only include what the owner asked for.
For fields an operation doesn't use, give "" or 0.
If part of the request isn't about these facts or isn't clear, put it in unclear, in Russian, as a short question back to the owner.`;

export async function opsFromRequest(sheet: Sheet, request: string): Promise<{ ops: EditOp[]; unclear: string }> {
  const facts = {
    hours: sheet.hours,
    address: sheet.address,
    prices: sheet.prices.map((p) => `${p.item} — ${p.amount} сом`),
    availability: sheet.availability.map((n) => n.text),
    item_details: sheet.prices.filter((p) => p.details).map((p) => `${p.item}: ${p.details}`),
    facts: (sheet.facts ?? []).map((f) => `${f.topic}: ${f.text}`),
  };
  const out = await jsonCall<{ ops: { op: EditOp["op"]; item: string; topic: string; amount: number; text: string }[]; unclear: string }>(
    SYSTEM,
    `<current_facts>${JSON.stringify(facts)}</current_facts>\n<owner_request>${request}</owner_request>`,
    {
      type: "object",
      properties: {
        ops: {
          type: "array",
          items: {
            type: "object",
            properties: {
              op: {
                type: "string",
                enum: ["set_price", "remove_price", "set_hours", "set_address", "set_availability", "remove_availability", "set_details", "set_fact", "remove_fact"],
              },
              item: { type: "string" },
              topic: { type: "string" },
              amount: { type: "number" },
              text: { type: "string" },
            },
            required: ["op", "item", "topic", "amount", "text"],
            additionalProperties: false,
          },
        },
        unclear: { type: "string" },
      },
      required: ["ops", "unclear"],
      additionalProperties: false,
    },
  );
  const ops: EditOp[] = out.ops.map((o) => {
    switch (o.op) {
      case "set_price":
        return { op: o.op, item: o.item, amount: o.amount };
      case "remove_price":
      case "remove_availability":
        return { op: o.op, item: o.item };
      case "set_availability":
      case "set_details":
        return { op: o.op, item: o.item, text: o.text };
      case "set_fact":
        return { op: o.op, topic: o.topic, text: o.text };
      case "remove_fact":
        return { op: o.op, topic: o.topic };
      default:
        return { op: o.op, text: o.text };
    }
  });
  return { ops, unclear: out.unclear.trim() };
}
