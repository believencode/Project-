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

/** Details the bot collects for a booking or an order. */
export interface Slots {
  item?: string;
  size?: string;
  day?: string;
  time?: string;
  people?: number;
}
export type Slot = keyof Slots;

/** A booking or order the bot is still collecting details for. */
export interface Draft {
  kind: "booking" | "order";
  slots: Slots;
  /** The slot the bot last asked for, and how many answers in a row failed to fill it. */
  asked?: Slot;
  misses: number;
}

/** A finished booking or order, waiting for staff to confirm in one tap. */
export interface ActionRequest {
  id: string;
  kind: "booking" | "order";
  slots: Slots;
  summary: string;
  status: "pending" | "confirmed" | "declined";
  created_at: number;
}

/** One past message, as the classifier and reply model see it. */
export interface HistoryLine {
  from: Sender;
  text: string;
  label?: Label;
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
  draft?: Draft | null;
  requests?: ActionRequest[];
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
  /** Which model answered, when path is LLM. */
  model?: string;
  /** A short clarifying question instead of a handoff, e.g. "Какой размер нужен?". */
  follow_up?: string | null;
  /** Booking/order details found in this message. */
  slots?: Slots;
  /** The customer called off the booking/order in progress. */
  cancel?: boolean;
  /** This message answered the bot's question about a booking/order in progress. */
  continues_draft?: boolean;
}
