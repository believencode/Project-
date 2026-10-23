export type BusinessType = "cafe" | "salon" | "shop" | "clinic" | "services" | "other";

export const LABELS = [
  "greeting",
  "price",
  "hours",
  "booking",
  "order",
  "address",
  "availability",
  "info",
  "off_topic",
] as const;
export type Label = (typeof LABELS)[number];

export type Topic = "price" | "hours" | "booking" | "order" | "address" | "availability";

/** Where a fact came from: a message in an imported chat, or the owner. */
export interface FactSource {
  by: "chat" | "owner";
  /** Customer name of the chat the message is in. */
  customer?: string;
  at: number;
  /** The message, word for word. */
  quote?: string;
  /** The owner said this fact (found in a chat) is right. */
  confirmed?: boolean;
}

export interface PriceItem {
  id: string;
  item: string;
  amount: number;
  currency: string;
  needs_check: boolean;
  source?: FactSource;
  /** Other prices staff quoted for the same item at other times: the owner picks one. */
  alternatives?: { amount: number; source: FactSource }[];
  /** Catalog details that don't change often: sizes made, colours, what's included. */
  details?: string;
}

export interface AvailabilityNote {
  id: string;
  text: string;
  needs_check: boolean;
  source?: FactSource;
}

/**
 * Anything else customers ask about the business: delivery, payment, returns,
 * parking, warranty… One fact, in the owner's words.
 */
export interface InfoFact {
  id: string;
  /** Short topic in Russian, e.g. "Доставка". */
  topic: string;
  text: string;
  needs_check: boolean;
  source?: FactSource;
}

/**
 * A fact the app proposes after staff answered a question the bot couldn't:
 * the owner adds it to the knowledge base in one tap, and the bot answers it next time.
 */
export interface FactSuggestion {
  /** The bot's "a staff member will check" message this answers. */
  id: string;
  question: string;
  answer: string;
  topic: string;
  text: string;
  at: number;
  /** Set once the owner added it to the knowledge base or dismissed it. */
  status?: "added" | "dismissed";
}

/** Reply language: always Russian, always Kyrgyz, or match the customer. */
export type ReplyLanguage = "ru" | "ky" | "both";

export interface Sheet {
  name: string;
  type: BusinessType;
  /** What the business does, in the owner's words ("автомойка"). Needed for "other". */
  about?: string;
  language?: ReplyLanguage;
  hours: string;
  address: string;
  hours_source?: FactSource;
  address_source?: FactSource;
  prices: PriceItem[];
  availability: AvailabilityNote[];
  /** Other facts (delivery, payment, returns…). Missing in sheets made before the knowledge base. */
  facts?: InfoFact[];
  top_questions: string[];
  tone_examples: string[];
  allowed_topics: Topic[];
}

export type Sender = "customer" | "bot" | "staff" | "system";

/**
 * What a bot message has to say. Code decides the intent; the AI writes the
 * words. `answer` and `follow_up` are written by the reply model directly.
 */
export type BotIntent =
  | { type: "answer" }
  | { type: "follow_up" }
  | { type: "greeting" }
  | { type: "off_topic" }
  | { type: "handoff" }
  | { type: "missing" }
  | { type: "ask_slot"; slot: Slot; kind: "booking" | "order"; options?: string[]; retry?: boolean }
  | { type: "draft_done"; kind: "booking" | "order"; summary: string }
  | { type: "cancelled" }
  | { type: "confirmed"; kind: "booking" | "order"; summary: string }
  | { type: "declined"; kind: "booking" | "order"; summary: string };

/** What a system line in a chat says, so the app can show it in the owner's language. */
export type SystemNote =
  | { code: "handoff_off_topic" }
  | { code: "settled"; ok: boolean; summary: string }
  | { code: "paused"; echo: boolean }
  | { code: "resumed" }
  | { code: "pause_ended" };

export interface Message {
  id: string;
  from: Sender;
  text: string;
  at: number;
  kind?: "text" | "voice" | "photo";
  label?: Label;
  path?: "LLM" | "rules";
  intent?: BotIntent;
  /** Bot messages: written by the AI, or a fixed line (demo mode without an AI key). */
  written_by?: "ai" | "template";
  /** WhatsApp chats: the message could not be sent to the customer. */
  delivery?: "failed";
  /** System lines: what happened (the English `text` stays for logs and older app versions). */
  note?: SystemNote;
}

export type NeedsPersonReason = "Off-topic" | "Missing answer" | "Voice/photo" | "Booking/order" | "AI unavailable";

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
  /** A real WhatsApp chat (customer messages come from WhatsApp, replies go out on WhatsApp). */
  is_whatsapp?: boolean;
  /** An old chat the owner shared when connecting WhatsApp: read for facts, never answered. */
  imported?: boolean;
  /** Facts proposed from staff answers in this chat, waiting for the owner. */
  fact_suggestions?: FactSuggestion[];
}

export interface BackupAnswers {
  asks: Topic[];
  goal: "answer" | "orders" | "booking" | "phone";
  language: "ru" | "ky" | "both";
  notes: string;
}

/** WhatsApp alerts to the owner when a chat needs a person. */
export interface AlertSettings {
  /** The owner's personal WhatsApp number, digits with country code (996555123456). */
  phone: string;
  enabled: boolean;
  /** The owner's app language when they saved it; alerts are written in it. */
  lang: "ru" | "ky" | "en";
}

export interface Business {
  id: string;
  sheet: Sheet;
  chats: Chat[];
  imported_history: boolean;
  live: boolean;
  backup?: BackupAnswers;
  /** Who built the sheet from the imported chats: the AI, or demo facts (no AI key). */
  sheet_built_by?: "ai" | "demo";
  alerts?: AlertSettings;
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
