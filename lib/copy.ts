import type { BusinessType, Topic } from "./types";

/** Fixed bot lines. Every message the bot sends is Russian. */
export const MISSING_ANSWER_LINE = "Сотрудник уточнит и ответит вам.";
export const HANDOFF_LINE = "Вам ответит сотрудник.";

export const OFF_TOPIC_TOPICS: Record<BusinessType, string> = {
  shop: "цены, наличие, доставку, адрес и часы работы",
  cafe: "меню и цены, бронь столика, адрес и часы работы",
  salon: "цены, запись, свободное время, адрес и часы работы",
  clinic: "цены, запись, свободное время, адрес и часы работы",
  services: "цены, заказ, сроки, адрес и часы работы",
  other: "цены, адрес и часы работы",
};

export function offTopicLine(type: BusinessType): string {
  return `Я могу помочь только с вопросами про ${OFF_TOPIC_TOPICS[type]}. Если нужно что-то другое, вам ответит сотрудник.`;
}

export const BUSINESS_TYPES: { id: BusinessType; label: string }[] = [
  { id: "cafe", label: "Café" },
  { id: "salon", label: "Salon" },
  { id: "shop", label: "Shop" },
  { id: "clinic", label: "Clinic" },
  { id: "services", label: "Services" },
  { id: "other", label: "Other" },
];

/** Allowed topics, the same for every business. */
export const ALLOWED_TOPICS: Topic[] = ["price", "hours", "booking", "order", "address", "availability"];

export const AVAILABILITY_EXAMPLE: Record<BusinessType, string> = {
  cafe: "Свободные столики сегодня вечером",
  shop: "Размеры в наличии",
  salon: "Свободное время завтра",
  clinic: "Свободное время на неделе",
  services: "Ближайший срок выполнения",
  other: "Что есть в наличии",
};

export const EMPTY_STATE_EXAMPLE: Record<BusinessType, string> = {
  cafe: "Например: «Сколько стоит лагман?»",
  shop: "Например: «Какие размеры есть?»",
  salon: "Например: «Есть время на маникюр завтра?»",
  clinic: "Например: «Сколько стоит приём терапевта?»",
  services: "Например: «Сколько стоит ремонт?»",
  other: "Например: «Во сколько вы открываетесь?»",
};
