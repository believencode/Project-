import type { Draft, HistoryLine, Label, ReplyDecision, Sheet } from "./types";
import { contextItem, extractSlots, isCancel } from "./actions";
import { findItems, mentions, normalize, words } from "./text";

/** Keyword fallback used when no LLM is configured. */

export { mentions, normalize };

const GREETING_WORDS = new Set([
  "здравствуйте", "здравствуй", "привет", "салам", "салем", "саламатсызбы", "добрый", "доброе", "день",
  "вечер", "утро", "спасибо", "благодарю", "большое", "пока", "до", "свидания", "ок", "окей", "ok",
  "хорошо", "понятно", "ясно", "рахмат", "чоң", "всего", "доброго",
]);

const RULES: [Exclude<Label, "greeting" | "off_topic">, RegExp][] = [
  ["price", /сколько сто|сколько будет|цена|цены|цену|почем|прайс|стоимост/],
  ["booking", /брон|запиш|запис|отлож|столик на|на прием/],
  ["order", /заказ|закаж|оформ|куплю|возьму|беру|доставьте/],
  ["availability", /размер|налич|осталис|остались|доставк|привез|свободн|окошк|слот|сколько ждать|срок/],
  ["hours", /во сколько|до скольки|со скольки|часы работы|режим работы|график|открыва|закрыва|работаете|открыты/],
  ["address", /адрес|где вы|где наход|как добраться|как доехать|локац|ориентир|2гис|2gis/],
  ["order", /хочу/],
];

const hasSize = (msg: string) => /(?:^|[^\d:.])[34]\d(?![\d:.])/.test(msg.replace(/\d{1,2}[:.]\d{2}/g, ""));

/** The label of the customer's last on-topic question, for follow-ups like "а лоферы?". */
function lastTopic(history: HistoryLine[]): Label | undefined {
  for (const line of [...history].reverse()) {
    if (line.from === "customer" && line.label && line.label !== "greeting" && line.label !== "off_topic") return line.label;
  }
  return undefined;
}

export function classify(text: string, sheet: Sheet, history: HistoryLine[] = []): Label {
  const msg = normalize(text).trim();
  const tokens = words(msg);
  if (tokens.length > 0 && tokens.every((w) => GREETING_WORDS.has(w))) return "greeting";

  for (const [label, re] of RULES) if (re.test(msg)) return label;

  const itemHere = findItems(msg, sheet.prices.map((p) => p.item)).length > 0;
  const itemBefore = contextItem(history, sheet) !== undefined;
  // "Лагман есть?", or "а 42 есть?" right after asking about sneakers: a stock question.
  if ((itemHere || itemBefore) && (/(^|[^а-я])есть([^а-я]|$)/.test(msg) || (sheet.type === "shop" && hasSize(msg)))) {
    return "availability";
  }
  // "А лоферы?" continues the previous question.
  if (itemHere) {
    const prev = lastTopic(history);
    return prev === "availability" ? "availability" : "price";
  }
  return "off_topic";
}

function confirmed<T extends { needs_check: boolean }>(xs: T[]): T[] {
  return xs.filter((x) => !x.needs_check);
}

function greetingReply(text: string): string {
  const msg = normalize(text);
  if (/спасибо|благодар|рахмат/.test(msg)) return "Пожалуйста! Если будут вопросы — пишите.";
  if (/пока|свидани|всего/.test(msg)) return "Всего доброго!";
  if (/^(ок|окей|ok|хорошо|понятно|ясно)/.test(msg.trim())) return "Хорошо! Если будут вопросы — пишите.";
  return "Здравствуйте! Чем могу помочь?";
}

/** Reply only from confirmed sheet facts. Returns null with missing=true if a fact is absent. */
export function replyFromSheet(
  label: Label,
  text: string,
  sheet: Sheet,
  history: HistoryLine[] = [],
): { reply: string | null; missing: boolean; follow_up?: string } {
  // Items named in this message, or else the one the conversation is about.
  const named = findItems(text, sheet.prices.map((p) => p.item));
  const ctx = contextItem(history, sheet);
  const items = named.length > 0 ? named : ctx ? [ctx] : [];

  switch (label) {
    case "greeting":
      return { reply: greetingReply(text), missing: false };
    case "off_topic":
    case "booking":
    case "order":
      return { reply: null, missing: false };
    case "hours":
      return sheet.hours.trim()
        ? { reply: `Мы работаем ${sheet.hours}.`, missing: false }
        : { reply: null, missing: true };
    case "address":
      return sheet.address.trim()
        ? { reply: `Наш адрес: ${sheet.address}.`, missing: false }
        : { reply: null, missing: true };
    case "price": {
      if (items.length > 0) {
        const ok = confirmed(sheet.prices.filter((p) => items.includes(p.item)));
        if (ok.length === 0) return { reply: null, missing: true };
        return { reply: ok.map((p) => `${p.item} — ${p.amount} ${p.currency}.`).join(" "), missing: false };
      }
      const ok = confirmed(sheet.prices);
      if (ok.length === 0) return { reply: null, missing: true };
      // Too many to list: ask which one instead.
      if (ok.length > 3) {
        return { reply: null, missing: false, follow_up: `Что именно вас интересует? Например: ${ok.slice(0, 3).map((p) => p.item.toLowerCase()).join(", ")}.` };
      }
      return {
        reply: `Наши цены: ${ok.map((p) => `${p.item.toLowerCase()} — ${p.amount} ${p.currency}`).join("; ")}. Если нужно что-то другое, сотрудник уточнит.`,
        missing: false,
      };
    }
    case "availability": {
      // A note like "Белые кроссовки: размеры 40–43" is about the item before the colon.
      const about = (note: string) => (note.includes(":") ? note.split(":")[0] : "");
      const specific = sheet.availability.filter((n) => about(n.text));
      let relevant = sheet.availability.filter((n) => about(n.text) && items.some((i) => mentions(about(n.text), i) || mentions(i, about(n.text))));
      if (relevant.length === 0) {
        // Notes about several different items and no idea which one: ask.
        const subjects = new Set(confirmed(specific).map((n) => about(n.text)));
        if (items.length === 0 && subjects.size > 1) {
          return { reply: null, missing: false, follow_up: `Какая модель вас интересует: ${[...subjects].map((s) => s.toLowerCase()).join(" или ")}?` };
        }
        relevant = items.length > 0 && specific.length > 0 ? [] : sheet.availability;
      }
      const ok = confirmed(relevant);
      if (ok.length === 0) return { reply: null, missing: true };
      return {
        reply: `По последним данным: ${ok.map((n) => n.text).join("; ")}. Если нужно, сотрудник уточнит наличие.`,
        missing: false,
      };
    }
  }
}

export function decideWithRules(text: string, sheet: Sheet, history: HistoryLine[] = [], draft?: Draft | null): ReplyDecision {
  if (draft) {
    const slots = extractSlots(text, sheet, draft.asked);
    const cancel = isCancel(text);
    const fresh = Object.entries(slots).some(([k, v]) => draft.slots[k as keyof typeof slots] !== v);
    if (cancel || fresh) {
      return { label: draft.kind, reply: null, missing: false, path: "rules", slots, cancel, continues_draft: true };
    }
  }

  const label = classify(text, sheet, history);
  if (label === "booking" || label === "order") {
    const slots = extractSlots(text, sheet);
    // An order (or a shop hold) is about the item the chat was discussing; a table booking is not.
    const ctx = label === "order" || sheet.type === "shop" ? contextItem(history, sheet) : undefined;
    if (!slots.item && ctx) slots.item = ctx;
    return { label, reply: null, missing: false, path: "rules", slots };
  }
  const { reply, missing, follow_up } = replyFromSheet(label, text, sheet, history);
  return { label, reply, missing, path: "rules", follow_up: follow_up ?? null };
}
