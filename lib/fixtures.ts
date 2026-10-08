import type { Chat, Message, Sheet } from "./types";
import { ALLOWED_TOPICS } from "./copy";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

type Line = [from: "customer" | "staff", text: string, kind?: "voice"];

function chat(id: string, customer: string, phone: string, daysAgo: number, lines: Line[], now: number): Chat {
  const start = now - daysAgo * DAY;
  const messages: Message[] = lines.map(([from, text, kind], i) => ({
    id: `${id}-m${i}`,
    from,
    text,
    kind: kind ?? "text",
    at: start + i * 3 * MIN,
  }));
  return {
    id,
    customer,
    phone,
    messages,
    off_topic_count: 0,
    ai_stopped: false,
    paused_until: null,
    needs_person: null,
  };
}

/** Sheet "extracted" from the shoe shop's last six months of chats. */
export function shoeSheet(name = "Обувь 10"): Sheet {
  return {
    name,
    type: "shop",
    hours: "10:00–20:00",
    address: "Бишкек, 10 микрорайон, дом 34",
    prices: [
      { id: "p1", item: "Белые кроссовки", amount: 4500, currency: "сом", needs_check: true },
      { id: "p2", item: "Чёрные лоферы", amount: 5200, currency: "сом", needs_check: true },
    ],
    availability: [{ id: "a1", text: "Белые кроссовки: размеры 40–43", needs_check: true }],
    top_questions: ["Размер", "Цена", "Доставка", "Часы работы"],
    tone_examples: [
      "Здравствуйте! Да, есть 41 и 42, приходите 😊",
      "Доставка по Бишкеку 200 сом, привезём завтра.",
    ],
    allowed_topics: ALLOWED_TOPICS,
  };
}

/** Café fixture behind the new-business path. Never reuses shoe prices. */
export function cafeSheet(name = "Кафе"): Sheet {
  return {
    name,
    type: "cafe",
    hours: "09:00–22:00",
    address: "",
    prices: [{ id: "p1", item: "Лагман", amount: 250, currency: "сом", needs_check: true }],
    availability: [{ id: "a1", text: "Столик на 4 человек в 19:00", needs_check: true }],
    top_questions: ["Меню и цены", "Бронь столика", "Часы работы"],
    tone_examples: ["Здравствуйте! Лагман сегодня есть 🙂", "Столик на вечер забронировали, ждём вас!"],
    allowed_topics: ALLOWED_TOPICS,
  };
}

/** Eight one-to-one chats from the shoe shop. No group chats. One has a voice note. */
export function shoeChats(now: number): Chat[] {
  return [
    chat("c1", "Айгерим", "+996 555 120 431", 2, [
      ["customer", "Здравствуйте, белые кроссовки ещё есть?"],
      ["staff", "Здравствуйте! Да, есть 40–43 размеры."],
      ["customer", "Сколько стоят?"],
      ["staff", "4500 сом."],
    ], now),
    chat("c2", "Бакыт", "+996 700 884 219", 5, [
      ["customer", "До скольки работаете сегодня?"],
      ["staff", "До 20:00, приходите."],
    ], now),
    chat("c3", "Нурлан", "+996 772 301 556", 9, [
      ["customer", "Чёрные лоферы 42 есть?"],
      ["staff", "Есть, 5200 сом."],
      ["customer", "Доставка есть?"],
      ["staff", "Доставка по Бишкеку 200 сом, привезём завтра."],
    ], now),
    chat("c4", "Жылдыз", "+996 555 670 902", 14, [
      ["customer", "Где вы находитесь?"],
      ["staff", "10 микрорайон, дом 34."],
    ], now),
    chat("c5", "Эрлан", "+996 708 145 377", 21, [
      ["customer", "", "voice"],
      ["staff", "Здравствуйте! Да, можно обменять в течение 14 дней с чеком."],
    ], now),
    chat("c6", "Динара", "+996 550 993 018", 33, [
      ["customer", "Какой размер белых кроссовок есть?"],
      ["staff", "Здравствуйте! Да, есть 41 и 42, приходите 😊"],
    ], now),
    chat("c7", "Азамат", "+996 777 412 650", 48, [
      ["customer", "Скидки будут?"],
      ["staff", "Пока нет, следите за нашим статусом."],
    ], now),
    chat("c8", "Мээрим", "+996 555 238 714", 72, [
      ["customer", "Можно отложить белые кроссовки 41 до вечера?"],
      ["staff", "Да, отложили до 19:00."],
    ], now),
  ];
}

export function cafeChats(now: number): Chat[] {
  return [
    chat("k1", "Тимур", "+996 555 010 202", 1, [
      ["customer", "Лагман сегодня есть?"],
      ["staff", "Здравствуйте! Лагман сегодня есть 🙂"],
    ], now),
    chat("k2", "Асель", "+996 700 303 404", 3, [
      ["customer", "Можно столик на 4 на семь вечера?"],
      ["staff", "Столик на вечер забронировали, ждём вас!"],
    ], now),
  ];
}

export function testChat(): Chat {
  return {
    id: "test",
    customer: "Test customer",
    phone: "test",
    messages: [],
    off_topic_count: 0,
    ai_stopped: false,
    paused_until: null,
    needs_person: null,
    is_test: true,
  };
}
