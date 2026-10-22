import type { BotIntent, Sheet } from "./types";

/**
 * Checks an AI-written message before it is sent. The main rule: every number
 * in it (price, size, time, address) must come from a confirmed fact, the
 * request being discussed, or the customer's own words. So the AI can phrase
 * things freely but cannot invent a price or a time.
 */

/** "4 500" → 4500, "19:00" → 19, 0. */
export function numbersIn(text: string): number[] {
  const joined = text.replace(/(\d)[\s  ](?=\d{3}(?!\d))/g, "$1");
  return (joined.match(/\d+/g) ?? []).map(Number);
}

function confirmedFactsText(sheet: Sheet): string {
  return [
    sheet.hours,
    sheet.address,
    ...sheet.prices.filter((p) => !p.needs_check).map((p) => `${p.item} ${p.amount}`),
    ...sheet.availability.filter((n) => !n.needs_check).map((n) => n.text),
  ].join(" ");
}

function allowedNumbers(sources: string[]): Set<number> {
  const out = new Set<number>();
  for (const n of sources.flatMap(numbersIn)) {
    out.add(n);
    // 19:00 may be written as "в 7 вечера".
    if (n >= 13 && n <= 23) out.add(n - 12);
  }
  return out;
}

export interface GuardInput {
  intent: BotIntent;
  sheet: Sheet;
  /** The customer's recent messages: their own numbers (size 42, 4 people) may be repeated back. */
  customerTexts: string[];
}

export function checkMessage(text: string, { intent, sheet, customerTexts }: GuardInput): { ok: true } | { ok: false; reason: string } {
  const t = text.trim();
  if (!t) return { ok: false, reason: "empty" };
  if (t.length > 500) return { ok: false, reason: "too long" };
  const sentences = t.split(/[.!?…]+(?:\s|$)/).filter((s) => s.trim()).length;
  if (sentences > 4) return { ok: false, reason: "more than 3 sentences" };
  if (/https?:|www\.|@\w/.test(t)) return { ok: false, reason: "contains a link or handle" };
  if (/[{}[\]<>]/.test(t)) return { ok: false, reason: "contains template brackets" };

  const sources = [...customerTexts];
  // Only answers may quote facts; a handoff or a question must not mention prices or times.
  if (intent.type === "answer" || intent.type === "follow_up") sources.push(confirmedFactsText(sheet));
  if ("summary" in intent) sources.push(intent.summary);
  if (intent.type === "ask_slot" && intent.options) sources.push(intent.options.join(" "));
  const allowed = allowedNumbers(sources);
  const stray = numbersIn(t).filter((n) => !allowed.has(n));
  if (stray.length > 0) return { ok: false, reason: `number not in confirmed facts: ${stray.join(", ")}` };

  return { ok: true };
}
