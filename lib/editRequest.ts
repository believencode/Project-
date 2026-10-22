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
Use item names from <current_facts> when the owner means an existing item. Only include what the owner asked for.
For fields an operation doesn't use, give "" or 0.
If part of the request isn't about these facts or isn't clear, put it in unclear, in Russian, as a short question back to the owner.`;

export async function opsFromRequest(sheet: Sheet, request: string): Promise<{ ops: EditOp[]; unclear: string }> {
  const facts = {
    hours: sheet.hours,
    address: sheet.address,
    prices: sheet.prices.map((p) => `${p.item} — ${p.amount} сом`),
    availability: sheet.availability.map((n) => n.text),
  };
  const out = await jsonCall<{ ops: { op: EditOp["op"]; item: string; amount: number; text: string }[]; unclear: string }>(
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
              op: { type: "string", enum: ["set_price", "remove_price", "set_hours", "set_address", "set_availability", "remove_availability"] },
              item: { type: "string" },
              amount: { type: "number" },
              text: { type: "string" },
            },
            required: ["op", "item", "amount", "text"],
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
        return { op: o.op, item: o.item, text: o.text };
      default:
        return { op: o.op, text: o.text };
    }
  });
  return { ops, unclear: out.unclear.trim() };
}
