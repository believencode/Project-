import type { FactSource, Sheet } from "./types";
import { numbersIn } from "./guard";
import { findItems, normalize } from "./text";

/**
 * Changes the owner asks for in their own words ("лагман теперь 280,
 * закрываемся в 23:00"). The AI turns the request into these operations; code
 * checks them and the owner sees each change before it's applied.
 */

export type EditOp =
  | { op: "set_price"; item: string; amount: number }
  | { op: "remove_price"; item: string }
  | { op: "set_hours"; text: string }
  | { op: "set_address"; text: string }
  | { op: "set_availability"; item: string; text: string }
  | { op: "remove_availability"; item: string }
  | { op: "set_details"; item: string; text: string }
  | { op: "set_fact"; topic: string; text: string }
  | { op: "remove_fact"; topic: string };

/** The sheet entry an op refers to, matched loosely ("лоферы" → "Чёрные лоферы"). */
function priceIndex(sheet: Sheet, item: string): number {
  const exact = sheet.prices.findIndex((p) => normalize(p.item) === normalize(item));
  if (exact >= 0) return exact;
  const hit = findItems(item, sheet.prices.map((p) => p.item));
  return hit.length === 1 ? sheet.prices.findIndex((p) => p.item === hit[0]) : -1;
}

/** The fact about this topic ("доставка" → the "Доставка" fact). */
function factIndex(sheet: Sheet, topic: string): number {
  const facts = sheet.facts ?? [];
  const exact = facts.findIndex((f) => normalize(f.topic) === normalize(topic));
  if (exact >= 0) return exact;
  const hit = findItems(topic, facts.map((f) => f.topic));
  return hit.length === 1 ? facts.findIndex((f) => f.topic === hit[0]) : -1;
}

function noteIndex(sheet: Sheet, item: string): number {
  return sheet.availability.findIndex((n) => findItems(n.text, [item]).length > 0 || findItems(item, [n.text.split(":")[0]]).length > 0);
}

/**
 * Keep only operations the request backs up: a new price must appear in the
 * owner's words; a removal must name something that exists.
 */
export function validateOps(ops: EditOp[], sheet: Sheet, request: string): { ok: EditOp[]; dropped: string[] } {
  const said = new Set(numbersIn(request));
  const known = new Set([...said, ...numbersIn([sheet.hours, sheet.address].join(" "))]);
  const ok: EditOp[] = [];
  const dropped: string[] = [];
  for (const op of ops) {
    switch (op.op) {
      case "set_price":
        if (!op.item.trim() || !(op.amount > 0) || !said.has(op.amount)) dropped.push(`price for «${op.item}»`);
        else ok.push(op);
        break;
      case "remove_price":
        if (priceIndex(sheet, op.item) < 0) dropped.push(`removing «${op.item}» (not in your prices)`);
        else ok.push(op);
        break;
      case "remove_availability":
        if (noteIndex(sheet, op.item) < 0) dropped.push(`removing stock note «${op.item}»`);
        else ok.push(op);
        break;
      case "remove_fact":
        if (factIndex(sheet, op.topic) < 0) dropped.push(`removing «${op.topic}» (not in your facts)`);
        else ok.push(op);
        break;
      case "set_details":
        if (priceIndex(sheet, op.item) < 0 || !op.text.trim() || !numbersIn(op.text).every((n) => said.has(n))) dropped.push(`details for «${op.item}»`);
        else ok.push(op);
        break;
      case "set_fact":
        // A new fact's numbers must be in the owner's words.
        if (!op.topic.trim() || !op.text.trim() || !numbersIn(op.text).every((n) => said.has(n))) dropped.push(`«${op.topic || op.text}»`);
        else ok.push(op);
        break;
      case "set_hours":
      case "set_address":
      case "set_availability":
        if (!op.text.trim() || !numbersIn(op.text).every((n) => known.has(n))) dropped.push(op.op.replace("set_", ""));
        else ok.push(op);
        break;
    }
  }
  return { ok, dropped };
}

export function describeOp(op: EditOp, sheet: Sheet): string {
  switch (op.op) {
    case "set_price": {
      const i = priceIndex(sheet, op.item);
      return i >= 0
        ? `${sheet.prices[i].item}: ${sheet.prices[i].amount} → ${op.amount} сом`
        : `Add price: ${op.item} — ${op.amount} сом`;
    }
    case "remove_price": {
      const i = priceIndex(sheet, op.item);
      return `Remove price: ${i >= 0 ? sheet.prices[i].item : op.item}`;
    }
    case "set_hours":
      return `Hours: ${sheet.hours || "not set"} → ${op.text}`;
    case "set_address":
      return `Address: ${sheet.address || "not set"} → ${op.text}`;
    case "set_availability": {
      const i = noteIndex(sheet, op.item);
      return i >= 0 ? `Stock: «${sheet.availability[i].text}» → «${op.text}»` : `Add stock note: «${op.text}»`;
    }
    case "remove_availability": {
      const i = noteIndex(sheet, op.item);
      return `Remove stock note: «${i >= 0 ? sheet.availability[i].text : op.item}»`;
    }
    case "set_details": {
      const i = priceIndex(sheet, op.item);
      return `${i >= 0 ? sheet.prices[i].item : op.item} details: «${op.text}»`;
    }
    case "set_fact": {
      const i = factIndex(sheet, op.topic);
      return i >= 0 ? `${sheet.facts![i].topic}: «${sheet.facts![i].text}» → «${op.text}»` : `Add fact: ${op.topic} — «${op.text}»`;
    }
    case "remove_fact": {
      const i = factIndex(sheet, op.topic);
      return `Remove fact: ${i >= 0 ? sheet.facts![i].topic : op.topic}`;
    }
  }
}

/** Apply checked operations. What the owner says is confirmed, with the owner as the source. */
export function applyOps(sheet: Sheet, ops: EditOp[], now: number): Sheet {
  const owner: FactSource = { by: "owner", at: now };
  let next: Sheet = { ...sheet, prices: [...sheet.prices], availability: [...sheet.availability], facts: [...(sheet.facts ?? [])] };
  ops.forEach((op, k) => {
    switch (op.op) {
      case "set_price": {
        const i = priceIndex(next, op.item);
        if (i >= 0) next.prices[i] = { ...next.prices[i], amount: op.amount, needs_check: false, alternatives: undefined, source: owner };
        else next.prices.push({ id: `pe${now}-${k}`, item: op.item.trim(), amount: op.amount, currency: "сом", needs_check: false, source: owner });
        break;
      }
      case "remove_price": {
        const i = priceIndex(next, op.item);
        if (i >= 0) next.prices.splice(i, 1);
        break;
      }
      case "set_hours":
        next = { ...next, hours: op.text.trim(), hours_source: owner };
        break;
      case "set_address":
        next = { ...next, address: op.text.trim(), address_source: owner };
        break;
      case "set_availability": {
        const i = noteIndex(next, op.item);
        const note = { text: op.text.trim(), needs_check: false, source: owner };
        if (i >= 0) next.availability[i] = { ...next.availability[i], ...note };
        else next.availability.push({ id: `ae${now}-${k}`, ...note });
        break;
      }
      case "remove_availability": {
        const i = noteIndex(next, op.item);
        if (i >= 0) next.availability.splice(i, 1);
        break;
      }
      case "set_details": {
        const i = priceIndex(next, op.item);
        if (i >= 0) next.prices[i] = { ...next.prices[i], details: op.text.trim() };
        break;
      }
      case "set_fact": {
        const i = factIndex(next, op.topic);
        const fact = { topic: op.topic.trim(), text: op.text.trim(), needs_check: false, source: owner };
        if (i >= 0) next.facts![i] = { ...next.facts![i], ...fact, topic: next.facts![i].topic };
        else next.facts!.push({ id: `fe${now}-${k}`, ...fact });
        break;
      }
      case "remove_fact": {
        const i = factIndex(next, op.topic);
        if (i >= 0) next.facts!.splice(i, 1);
        break;
      }
    }
  });
  return next;
}
