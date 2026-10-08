export type BusinessType = "cafe" | "salon" | "shop" | "clinic" | "services" | "other";

export const LABELS = [
  "greeting",
  "price",
  "hours",
  "booking",
  "order",
  "address",
  "availability",
  "off_topic",
] as const;
export type Label = (typeof LABELS)[number];

export type Topic = "price" | "hours" | "booking" | "order" | "address" | "availability";

export interface PriceItem {
  id: string;
  item: string;
  amount: number;
  currency: string;
  needs_check: boolean;
}

export interface AvailabilityNote {
  id: string;
  text: string;
  needs_check: boolean;
}

export interface Sheet {
  name: string;
  type: BusinessType;
  hours: string;
  address: string;
  prices: PriceItem[];
  availability: AvailabilityNote[];
  top_questions: string[];
  tone_examples: string[];
  allowed_topics: Topic[];
}

export type Sender = "customer" | "bot" | "staff" | "system";

export interface Message {
  id: string;
  from: Sender;
  text: string;
  at: number;
  kind?: "text" | "voice" | "photo";
  label?: Label;
  path?: "LLM" | "rules";
}

export type NeedsPersonReason = "Off-topic" | "Missing answer" | "Voice/photo" | "Booking/order";

export interface NeedsPerson {
  reason: NeedsPersonReason;
  details: string[];
}

export interface Chat {
  id: string;
  customer: string;
  phone: string;
  messages: Message[];
  off_topic_count: number;
  ai_stopped: boolean;
  paused_until: number | null;
  needs_person: NeedsPerson | null;
  is_test?: boolean;
}

export interface BackupAnswers {
  asks: Topic[];
  goal: "answer" | "orders" | "booking" | "phone";
  language: "ru" | "ky" | "both";
  notes: string;
}

export interface Business {
  id: string;
  sheet: Sheet;
  chats: Chat[];
  imported_history: boolean;
  live: boolean;
  backup?: BackupAnswers;
}

/** What /api/reply returns for one customer message. */
export interface ReplyDecision {
  label: Label;
  /** null means the bot sends nothing (handled by the engine for off_topic / missing). */
  reply: string | null;
  /** The label is allowed, but the needed fact is not in the sheet or not confirmed. */
  missing: boolean;
  path: "LLM" | "rules";
}
