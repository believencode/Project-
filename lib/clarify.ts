import type { FactSource, Sheet } from "./types";

/**
 * After the AI reads the chats, the owner answers one question per unclear
 * fact: prices that disagree, prices and stock notes to confirm, hours and
 * address to confirm or fill in. Answers are applied to the sheet at the end.
 */

export type Question =
  | { id: string; kind: "price_conflict"; priceId: string }
  | { id: string; kind: "price"; priceId: string }
  | { id: string; kind: "availability"; noteId: string }
  | { id: string; kind: "hours" }
  | { id: string; kind: "address" }
  | { id: string; kind: "prices_missing" };

export type Answer =
  | { action: "keep" }
  | { action: "set_amount"; amount: number }
  | { action: "set_text"; text: string }
  | { action: "add_prices"; lines: { item: string; amount: number }[] }
  | { action: "remove" }
  | { action: "skip" };

export function buildQuestions(sheet: Sheet): Question[] {
  const qs: Question[] = [];
  for (const p of sheet.prices) {
    if (p.alternatives?.length) qs.push({ id: `conflict-${p.id}`, kind: "price_conflict", priceId: p.id });
    else if (p.needs_check) qs.push({ id: `price-${p.id}`, kind: "price", priceId: p.id });
  }
  if (sheet.prices.length === 0) qs.push({ id: "prices-missing", kind: "prices_missing" });
  for (const n of sheet.availability) if (n.needs_check) qs.push({ id: `avail-${n.id}`, kind: "availability", noteId: n.id });
  // Hours and address: confirm what the AI found in the chats, or ask when nothing was found.
  const unconfirmed = (src?: FactSource) => src?.by === "chat" && !src.confirmed;
  if (!sheet.hours || unconfirmed(sheet.hours_source)) qs.push({ id: "hours", kind: "hours" });
  if (!sheet.address || unconfirmed(sheet.address_source)) qs.push({ id: "address", kind: "address" });
  return qs;
}

/** Parse "Лагман 250" / "Манты — 300 сом" lines the owner types. */
export function parsePriceLines(text: string): { item: string; amount: number }[] {
  return text
    .split(/\n|;/)
    .map((line) => line.match(/^\s*(.+?)\s*[—–:-]?\s*(\d[\d\s]*)\s*(сом)?\s*$/i))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({ item: m[1].trim(), amount: Number(m[2].replace(/\s/g, "")) }))
    .filter((p) => p.item && p.amount > 0)
    .slice(0, 10);
}

export function applyAnswers(sheet: Sheet, questions: Question[], answers: Record<string, Answer>, now: number): Sheet {
  const owner: FactSource = { by: "owner", at: now };
  let next: Sheet = { ...sheet, prices: [...sheet.prices], availability: [...sheet.availability] };

  for (const q of questions) {
    const a = answers[q.id];
    if (!a || a.action === "skip") continue;
    switch (q.kind) {
      case "price":
      case "price_conflict":
        if (a.action === "remove") next.prices = next.prices.filter((p) => p.id !== q.priceId);
        else
          next.prices = next.prices.map((p) => {
            if (p.id !== q.priceId) return p;
            if (a.action === "set_amount") {
              // Picked one of the quoted prices: keep that message as the source; typed a new one: the owner is.
              const picked = [{ amount: p.amount, source: p.source }, ...(p.alternatives ?? [])].find((x) => x.amount === a.amount);
              return { ...p, amount: a.amount, needs_check: false, alternatives: undefined, source: picked?.source ?? owner };
            }
            return { ...p, needs_check: false, alternatives: undefined };
          });
        break;
      case "availability":
        if (a.action === "remove") next.availability = next.availability.filter((n) => n.id !== q.noteId);
        else
          next.availability = next.availability.map((n) =>
            n.id !== q.noteId ? n : a.action === "set_text" ? { ...n, text: a.text, needs_check: false, source: owner } : { ...n, needs_check: false },
          );
        break;
      case "hours":
        if (a.action === "set_text") next = { ...next, hours: a.text, hours_source: owner };
        else if (a.action === "keep" && next.hours_source) next = { ...next, hours_source: { ...next.hours_source, confirmed: true } };
        break;
      case "address":
        if (a.action === "set_text") next = { ...next, address: a.text, address_source: owner };
        else if (a.action === "keep" && next.address_source) next = { ...next, address_source: { ...next.address_source, confirmed: true } };
        break;
      case "prices_missing":
        if (a.action === "add_prices") {
          next.prices = a.lines.map((l, i) => ({ id: `po${i}`, item: l.item, amount: l.amount, currency: "сом", needs_check: false, source: owner }));
        }
        break;
    }
  }
  return next;
}
