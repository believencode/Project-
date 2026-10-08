import type { Label, ReplyDecision, Sheet } from "./types";
import { BOOKING_LINE, ORDER_LINE } from "./copy";

/** Keyword fallback used when no LLM is configured. */

export function normalize(text: string): string {
  return text.toLowerCase().replace(/ё/g, "е");
}

function words(text: string): string[] {
  return normalize(text).split(/[^a-zа-я0-9]+/).filter(Boolean);
}

/** Crude Russian stemming: compare the first 4 letters of each word. */
function stems(text: string): string[] {
  return words(text)
    .filter((w) => w.length >= 3)
    .map((w) => w.slice(0, 4));
}

/** True when every stem of `phrase` starts some word of `message`. */
export function mentions(message: string, phrase: string): boolean {
  const msgWords = words(message);
  const need = stems(phrase);
  return need.length > 0 && need.every((s) => msgWords.some((w) => w.startsWith(s)));
}

const GREETING_WORDS = new Set([
  "здравствуйте", "здравствуй", "привет", "салам", "салем", "саламатсызбы", "добрый", "доброе", "день",
  "вечер", "утро", "спасибо", "благодарю", "большое", "пока", "до", "свидания", "ок", "окей", "ok",
  "хорошо", "понятно", "ясно", "рахмат", "чоң", "всего", "доброго",
]);

const RULES: [Exclude<Label, "greeting" | "off_topic">, RegExp][] = [
  ["price", /сколько сто|сколько будет|цена|цены|цену|почем|прайс|стоимост/],
  ["booking", /брон|запиш|запис|отлож|столик на|на прием/],
  ["availability", /размер|налич|осталис|остались|доставк|привез|свободн|окошк|слот|сколько ждать|срок/],
  ["hours", /во сколько|до скольки|со скольки|часы работы|режим работы|график|открыва|закрыва|работаете|открыты/],
  ["address", /адрес|где вы|где наход|как добраться|как доехать|локац|ориентир|2гис|2gis/],
  ["order", /заказ|закаж|оформ|куплю|возьму|доставьте/],
];

export function classify(text: string, sheet: Sheet): Label {
  const msg = normalize(text).trim();
  const tokens = words(msg);
  if (tokens.length > 0 && tokens.every((w) => GREETING_WORDS.has(w))) return "greeting";

  for (const [label, re] of RULES) if (re.test(msg)) return label;

  // "Лагман есть?" — a known item plus "есть" is a stock question.
  const knowsItem = sheet.prices.some((p) => mentions(msg, p.item));
  if (knowsItem && /(^|[^а-я])есть([^а-я]|$)/.test(msg)) return "availability";
  if (knowsItem) return "price";

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
export function replyFromSheet(label: Label, text: string, sheet: Sheet): { reply: string | null; missing: boolean } {
  switch (label) {
    case "greeting":
      return { reply: greetingReply(text), missing: false };
    case "off_topic":
      return { reply: null, missing: false };
    case "hours":
      return sheet.hours.trim()
        ? { reply: `Мы работаем ${sheet.hours}.`, missing: false }
        : { reply: null, missing: true };
    case "address":
      return sheet.address.trim()
        ? { reply: `Наш адрес: ${sheet.address}.`, missing: false }
        : { reply: null, missing: true };
    case "booking":
      return { reply: BOOKING_LINE, missing: false };
    case "order":
      return { reply: ORDER_LINE, missing: false };
    case "price": {
      const asked = sheet.prices.filter((p) => mentions(text, p.item));
      if (asked.length > 0) {
        const ok = confirmed(asked);
        if (ok.length === 0) return { reply: null, missing: true };
        return {
          reply: ok.map((p) => `${p.item} — ${p.amount} ${p.currency}.`).join(" "),
          missing: false,
        };
      }
      const ok = confirmed(sheet.prices).slice(0, 3);
      if (ok.length === 0) return { reply: null, missing: true };
      return {
        reply: `Наши цены: ${ok.map((p) => `${p.item.toLowerCase()} — ${p.amount} ${p.currency}`).join("; ")}. Если нужно что-то другое, сотрудник уточнит.`,
        missing: false,
      };
    }
    case "availability": {
      // A note like "Белые кроссовки: размеры 40–43" is about the item before the colon.
      const about = (note: string) => (note.includes(":") ? note.split(":")[0] : "");
      let relevant = sheet.availability.filter((n) => about(n.text) && mentions(text, about(n.text)));
      if (relevant.length === 0) relevant = sheet.availability;
      const ok = confirmed(relevant);
      if (ok.length === 0) return { reply: null, missing: true };
      return {
        reply: `По последним данным: ${ok.map((n) => n.text).join("; ")}. Если нужно, сотрудник уточнит наличие.`,
        missing: false,
      };
    }
  }
}

export function decideWithRules(text: string, sheet: Sheet): ReplyDecision {
  const label = classify(text, sheet);
  const { reply, missing } = replyFromSheet(label, text, sheet);
  return { label, reply, missing, path: "rules" };
}
