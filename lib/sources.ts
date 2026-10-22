import type { Chat, FactSource, Message, PriceItem, Sheet } from "./types";
import { numbersIn } from "./guard";
import { findItems, normalize } from "./text";
import { overlap } from "./knowledge";

/**
 * Finds, for each fact in a sheet, the chat message that backs it, and the
 * other prices staff quoted for the same item. Done in code, not by the AI, so
 * a source can't be invented: it is always a real message from the chats.
 */

interface Located {
  chat: Chat;
  message: Message;
  index: number;
}

const toSource = ({ chat, message }: Located): FactSource => ({
  by: "chat",
  customer: chat.customer,
  at: message.at,
  quote: message.text,
});

function allMessages(chats: Chat[]): Located[] {
  return chats
    .filter((c) => !c.is_test)
    .flatMap((chat) => chat.messages.map((message, index) => ({ chat, message, index })))
    .filter(({ message }) => (message.kind ?? "text") === "text" && message.text.trim());
}

const newestFirst = (a: Located, b: Located) => b.message.at - a.message.at;

/** A bare "сколько стоит?" refers back to an earlier message. */
const BARE_PRICE_QUESTION = /^(а\s+)?(сколько|почем|цена|стоимость)[^а-я]*([а-я]+[^а-я]*){0,2}\??$/;

/** Which items a staff message is about: named in it, or in the customer question it answers. */
function itemsDiscussed(chat: Chat, index: number, items: string[]): string[] {
  const own = findItems(chat.messages[index].text, items);
  if (own.length > 0) return own;
  for (let j = index - 1; j >= Math.max(0, index - 4); j--) {
    const m = chat.messages[j];
    if (m.from !== "customer") continue;
    const named = findItems(m.text, items);
    if (named.length > 0) return named;
    if (!BARE_PRICE_QUESTION.test(normalize(m.text).trim())) return [];
  }
  return [];
}

/** Every price staff quoted for this item, newest first. */
function quotesFor(item: string, items: string[], located: Located[]): { amount: number; at: Located }[] {
  return located
    .filter(({ message }) => message.from === "staff")
    .filter(({ chat, index }) => itemsDiscussed(chat, index, items).includes(item))
    .flatMap((l) => numbersIn(l.message.text).filter((n) => n >= 100).map((amount) => ({ amount, at: l })))
    .sort((a, b) => newestFirst(a.at, b.at));
}

/** The newest message containing all these numbers (or, without numbers, mentioning the words). */
function newestContaining(text: string, located: Located[]): Located | undefined {
  const nums = numbersIn(text);
  const hits = located.filter(({ message }) => {
    if (nums.length > 0) {
      const have = numbersIn(message.text);
      return nums.every((n) => have.includes(n));
    }
    return findItems(message.text, [text]).length > 0;
  });
  return hits.sort((a, b) => (a.message.from === "staff" ? 0 : 1) - (b.message.from === "staff" ? 0 : 1) || newestFirst(a, b))[0];
}

function withPriceSources(p: PriceItem, items: string[], located: Located[]): PriceItem {
  if (p.source?.by === "owner") return p;
  const quotes = quotesFor(p.item, items, located);
  const own = quotes.find((q) => q.amount === p.amount)?.at ?? newestContaining(String(p.amount), located);
  // Newest quote per other amount.
  const others = new Map<number, Located>();
  for (const q of quotes) if (q.amount !== p.amount && !others.has(q.amount)) others.set(q.amount, q.at);
  return {
    ...p,
    source: own ? toSource(own) : p.source,
    alternatives: others.size > 0 ? [...others].map(([amount, at]) => ({ amount, source: toSource(at) })) : undefined,
  };
}

/** Same item listed twice by the AI with different prices: keep the newest, the rest become alternatives. */
function mergeDuplicates(prices: PriceItem[]): PriceItem[] {
  const out: PriceItem[] = [];
  for (const p of prices) {
    const same = out.find((q) => normalize(q.item) === normalize(p.item));
    if (!same) {
      out.push(p);
      continue;
    }
    const [newer, older] = (p.source?.at ?? 0) > (same.source?.at ?? 0) ? [p, same] : [same, p];
    const alternatives = [
      ...(newer.alternatives ?? []),
      ...(older.source ? [{ amount: older.amount, source: older.source }] : []),
      ...(older.alternatives ?? []),
    ].filter((a, i, all) => a.amount !== newer.amount && all.findIndex((b) => b.amount === a.amount) === i);
    out[out.indexOf(same)] = { ...newer, alternatives: alternatives.length ? alternatives : undefined };
  }
  return out;
}

/** The staff message a fact was taken from: the same numbers, then the most words in common. */
function factSource(text: string, located: Located[]): Located | undefined {
  const nums = numbersIn(text);
  return located
    .filter(({ message }) => message.from === "staff")
    .filter(({ message }) => nums.every((n) => numbersIn(message.text).includes(n)))
    .map((l) => ({ l, score: overlap(text, l.message.text) }))
    .filter((x) => x.score >= Math.min(2, overlap(text, text)))
    .sort((a, b) => b.score - a.score || newestFirst(a.l, b.l))[0]?.l;
}

export function attachSources(sheet: Sheet, chats: Chat[]): Sheet {
  const located = allMessages(chats);
  const items = sheet.prices.map((p) => p.item);
  const hours = sheet.hours && !sheet.hours_source ? newestContaining(sheet.hours, located) : undefined;
  const address = sheet.address && !sheet.address_source ? newestContaining(sheet.address, located) : undefined;
  return {
    ...sheet,
    hours_source: sheet.hours_source ?? (hours ? toSource(hours) : undefined),
    address_source: sheet.address_source ?? (address ? toSource(address) : undefined),
    prices: mergeDuplicates(sheet.prices.map((p) => withPriceSources(p, items, located))),
    availability: sheet.availability.map((n) => {
      if (n.source) return n;
      const hit = newestContaining(n.text, located);
      return hit ? { ...n, source: toSource(hit) } : n;
    }),
    facts: sheet.facts?.map((f) => {
      if (f.source) return f;
      const hit = factSource(f.text, located);
      return hit ? { ...f, source: toSource(hit) } : f;
    }),
  };
}
