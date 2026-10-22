import type { Chat, HistoryLine, InfoFact, PriceItem, Sheet } from "./types";
import { findItems, words } from "./text";

/**
 * The knowledge base beyond prices, hours and address: other facts (delivery,
 * payment, returns…) and catalog details. Code picks the facts that matter for
 * a question; the AI answers only from those.
 */

/** Up to this many facts or items, the AI sees them all; above it, only the best matches. */
export const SEND_ALL_UP_TO = 30;

const STOP = new Set([
  "есть", "если", "или", "как", "какой", "какая", "какие", "когда", "можно", "нужно", "надо", "это", "этот", "что",
  "чем", "вас", "ваш", "ваша", "ваши", "вам", "мне", "меня", "для", "при", "про", "под", "над", "без", "так", "уже",
  "еще", "тоже", "только", "очень", "будет", "пожалуйста", "здравствуйте", "скажите", "подскажите",
]);

/** Content-word stems: "доставкой" and "доставка" both give "дост". */
function stems(text: string): Set<string> {
  return new Set(words(text).filter((w) => w.length >= 3 && !STOP.has(w)).map((w) => w.slice(0, 4)));
}

/** How many content words two texts share. */
export function overlap(a: string, b: string): number {
  const sa = stems(a);
  let n = 0;
  for (const s of stems(b)) if (sa.has(s)) n++;
  return n;
}

const confirmed = <T extends { needs_check: boolean }>(xs: T[]) => xs.filter((x) => !x.needs_check);

function recentCustomerText(text: string, history: HistoryLine[]): string {
  return [text, ...history.filter((h) => h.from === "customer").slice(-2).map((h) => h.text)].join(" ");
}

function best<T>(xs: T[], score: (x: T) => number, limit: number): T[] {
  return xs
    .map((x, i) => ({ x, i, s: score(x) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((r) => r.x);
}

/** Confirmed facts for this question: all of them when there are few, else the best matches. */
export function relevantFacts(sheet: Sheet, text: string, history: HistoryLine[] = [], limit = 12): InfoFact[] {
  const facts = confirmed(sheet.facts ?? []);
  if (facts.length <= SEND_ALL_UP_TO) return facts;
  const query = recentCustomerText(text, history);
  // The newest message counts double: it's the question being asked.
  return best(facts, (f) => 2 * overlap(text, `${f.topic} ${f.text}`) + overlap(query, `${f.topic} ${f.text}`), limit);
}

/** Confirmed prices for this question: all of them in a small catalog, else the items being discussed. */
export function relevantPrices(sheet: Sheet, text: string, history: HistoryLine[] = [], limit = 15): PriceItem[] {
  const prices = confirmed(sheet.prices);
  if (prices.length <= SEND_ALL_UP_TO) return prices;
  const query = recentCustomerText(text, history);
  const named = new Set(findItems(query, prices.map((p) => p.item)));
  return best(prices, (p) => (named.has(p.item) ? 10 : 0) + overlap(query, `${p.item} ${p.details ?? ""}`), limit);
}

/** Demo mode without AI: the one confirmed fact that best matches the question. */
export function bestFact(sheet: Sheet, text: string): InfoFact | undefined {
  return best(confirmed(sheet.facts ?? []), (f) => overlap(text, `${f.topic} ${f.text}`), 1)[0];
}

const DAY = 24 * 60 * 60_000;

/**
 * The latest question the bot couldn't answer in this chat, and what staff
 * replied to it since. Null when there's nothing to learn from.
 */
export function unansweredQuestion(chat: Chat, now: number): { id: string; question: string; answers: string[] } | null {
  const i = chat.messages.findLastIndex((m) => m.from === "bot" && m.intent?.type === "missing");
  if (i < 0 || now - chat.messages[i].at > DAY) return null;
  const question = chat.messages
    .slice(0, i)
    .findLast((m) => m.from === "customer" && (m.kind ?? "text") === "text")?.text;
  const answers = chat.messages.slice(i + 1).filter((m) => m.from === "staff").map((m) => m.text);
  if (!question || answers.length === 0) return null;
  return { id: chat.messages[i].id, question, answers };
}

/** Suggestions in this business still waiting for the owner, newest first. */
export function pendingSuggestions(chats: Chat[]) {
  return chats
    .flatMap((chat) => (chat.fact_suggestions ?? []).filter((s) => !s.status).map((s) => ({ chat, s })))
    .sort((a, b) => b.s.at - a.s.at);
}

let factSeq = 0;
export function newFactId(): string {
  factSeq += 1;
  return `f-${Date.now().toString(36)}-${factSeq}`;
}
