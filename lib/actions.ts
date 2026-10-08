import type { Draft, HistoryLine, Sheet, Slot, Slots } from "./types";
import { findItems, normalize } from "./text";

/** Booking and order details: what to collect, how to ask, how to read answers. */

const DAYS = /сегодня|послезавтра|завтра|понедельник|вторник|сред[уа]|четверг|пятниц[уа]|суббот[уа]|воскресенье/;

const HOUR_WORDS: Record<string, number> = {
  один: 1, час: 1, два: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8,
  девять: 9, десять: 10, одиннадцать: 11, двенадцать: 12,
};

const PEOPLE_WORDS: Record<string, number> = {
  вдвоем: 2, двоих: 2, двое: 2, втроем: 3, троих: 3, трое: 3, вчетвером: 4, четверых: 4, четверо: 4,
  впятером: 5, пятерых: 5, пятеро: 5, шестерых: 6, шестеро: 6,
};

const pad = (n: number) => n.toString().padStart(2, "0");

/** Afternoon/evening words move a 1–11 hour into 13–23. */
function toTime(hour: number, minutes: number, rest: string): string | undefined {
  let h = hour;
  if (h < 12 && /вечер|дня|после обеда/.test(rest)) h += 12;
  if (h > 23 || minutes > 59) return undefined;
  return `${pad(h)}:${pad(minutes)}`;
}

function extractTime(msg: string, asked?: Slot): string | undefined {
  const clock = msg.match(/(\d{1,2})[:.](\d{2})/);
  if (clock) return toTime(Number(clock[1]), Number(clock[2]), msg);
  const num = msg.match(/(?:^|\s)(?:в|на|к)\s+(\d{1,2})(?!\d|\s*(?:человек|чел|персон|гост|размер))/);
  if (num) return toTime(Number(num[1]), 0, msg);
  const word = msg.match(/(?:^|\s)(?:в|на|к)\s+([а-я]+)\s*(утра|вечера|вечером|дня)?/);
  if (word && HOUR_WORDS[word[1]] !== undefined) return toTime(HOUR_WORDS[word[1]], 0, msg);
  if (asked === "time") {
    const bare = msg.match(/^\D*(\d{1,2})\D*$/);
    if (bare) return toTime(Number(bare[1]), 0, msg);
    const bareWord = msg.match(/^\s*([а-я]+)\s*(утра|вечера|вечером|дня)?\W*$/);
    if (bareWord && HOUR_WORDS[bareWord[1]] !== undefined) return toTime(HOUR_WORDS[bareWord[1]], 0, msg);
  }
  return undefined;
}

function extractPeople(msg: string, asked?: Slot): number | undefined {
  const m =
    msg.match(/(\d{1,2})\s*(?:человек|чел|персон|гост)/) ??
    msg.match(/нас\s+(\d{1,2})/) ??
    msg.match(/столик\S*\s+на\s+(\d{1,2})(?![\d:.])/);
  if (m) return Number(m[1]);
  for (const [w, n] of Object.entries(PEOPLE_WORDS)) if (msg.includes(w)) return n;
  if (asked === "people") {
    const bare = msg.match(/^\D*(\d{1,2})\D*$/);
    if (bare) return Number(bare[1]);
  }
  return undefined;
}

function extractSize(msg: string, sheet: Sheet, asked?: Slot): string | undefined {
  if (sheet.type !== "shop") return undefined;
  const m = msg.match(/(\d{2})\s*-?\s*(?:й|го|ой)?\s*размер/) ?? msg.match(/размер\S*\s*(\d{2})/);
  if (m) return m[1];
  // A bare shoe size such as "42" or "а 42 есть?", never part of a time.
  const bare = msg.replace(/\d{1,2}[:.]\d{2}/g, "").match(/(?:^|[^\d:.])([34]\d)(?![\d:.])/);
  if (bare && (asked === "size" || /есть|нужен|нужно|давайте|беру|размер/.test(msg) || /^\D*\d{2}\D*$/.test(msg))) return bare[1];
  return undefined;
}

/** The last sheet item mentioned in the recent conversation (newest first). */
export function contextItem(history: HistoryLine[], sheet: Sheet): string | undefined {
  for (const line of [...history].reverse().slice(0, 8)) {
    const hit = findItems(line.text, sheet.prices.map((p) => p.item));
    if (hit.length === 1) return hit[0];
  }
  return undefined;
}

export function extractSlots(text: string, sheet: Sheet, asked?: Slot): Slots {
  const msg = normalize(text);
  const slots: Slots = {};
  const items = findItems(msg, sheet.prices.map((p) => p.item));
  if (items.length === 1) slots.item = items[0];
  const day = msg.match(DAYS);
  if (day) slots.day = day[0];
  const time = extractTime(msg, asked);
  if (time) slots.time = time;
  const people = extractPeople(msg, asked);
  if (people) slots.people = people;
  const size = extractSize(msg, sheet, asked);
  if (size) slots.size = size;
  return slots;
}

export function isCancel(text: string): boolean {
  return /отмен|не надо|передумал|не нужно|уже не/.test(normalize(text));
}

export function requiredSlots(kind: Draft["kind"], sheet: Sheet): Slot[] {
  if (kind === "order") {
    const need: Slot[] = sheet.prices.length > 0 ? ["item"] : [];
    if (sheet.type === "shop") need.push("size");
    return need;
  }
  return sheet.type === "cafe" ? ["time", "people"] : ["time"];
}

export function missingSlot(draft: Draft, sheet: Sheet): Slot | undefined {
  return requiredSlots(draft.kind, sheet).find((s) => draft.slots[s] === undefined);
}

export function question(slot: Slot, draft: Draft, sheet: Sheet): string {
  switch (slot) {
    case "item": {
      const names = sheet.prices.slice(0, 4).map((p) => p.item.toLowerCase()).join(", ");
      return `Что хотите ${draft.kind === "order" ? "заказать" : "забронировать"}? Есть: ${names}.`;
    }
    case "size":
      return "Какой размер нужен?";
    case "time":
      if (sheet.type === "cafe") return "На какое время забронировать столик?";
      if (sheet.type === "shop") return "До какого времени отложить?";
      return "На какое время вас записать?";
    case "people":
      return "На сколько человек?";
    case "day":
      return "На какой день?";
  }
}

export function summarize(kind: Draft["kind"], slots: Slots, sheet: Sheet): string {
  const parts: string[] = [];
  if (kind === "booking" && sheet.type === "cafe") parts.push(slots.people ? `столик на ${slots.people}` : "столик");
  if (slots.item) parts.push(slots.item.toLowerCase());
  if (slots.size) parts.push(`размер ${slots.size}`);
  if (kind === "booking" && slots.people && sheet.type !== "cafe") parts.push(`${slots.people} чел.`);
  if (slots.time || slots.day) {
    const when = [slots.day ?? "сегодня", slots.time].filter(Boolean).join(" ");
    parts.push(kind === "booking" && sheet.type === "shop" ? `отложить до ${when}` : when);
  }
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function doneLine(kind: Draft["kind"], summary: string): string {
  return kind === "order"
    ? `Записал заказ: ${summary}. Сотрудник подтвердит его здесь в чате.`
    : `Записал: ${summary}. Сотрудник подтвердит бронь здесь в чате.`;
}

export function confirmedLine(kind: Draft["kind"], summary: string): string {
  return kind === "order" ? `Ваш заказ подтверждён: ${summary}. Спасибо!` : `Бронь подтверждена: ${summary}. Ждём вас!`;
}

export function declinedLine(kind: Draft["kind"], summary: string): string {
  return `К сожалению, не можем подтвердить ${kind === "order" ? "заказ" : "бронь"} (${summary}). Сотрудник напишет вам.`;
}

export const CANCEL_LINE = "Хорошо, отменил. Если что-то понадобится — пишите.";
