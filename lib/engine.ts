import type { BusinessType, Chat, Message, NeedsPerson, ReplyDecision } from "./types";
import { HANDOFF_LINE, MISSING_ANSWER_LINE, offTopicLine } from "./copy";

export const PAUSE_MS = 30 * 60_000;

let seq = 0;
export function newId(prefix = "m"): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}-${Math.random().toString(36).slice(2, 6)}`;
}

export function isPaused(chat: Chat, now: number): boolean {
  return chat.paused_until !== null && chat.paused_until > now;
}

/** Whether a customer message should be sent to the classifier at all. */
export function needsClassification(chat: Chat, kind: Message["kind"], now: number): boolean {
  return !isPaused(chat, now) && (kind ?? "text") === "text";
}

function msg(from: Message["from"], text: string, now: number, extra: Partial<Message> = {}): Message {
  return { id: newId(), from, text, at: now, kind: "text", ...extra };
}

function flag(chat: Chat, reason: NeedsPerson["reason"], detail: string): NeedsPerson {
  const prev = chat.needs_person?.reason === reason ? chat.needs_person.details : [];
  return { reason, details: [...prev, detail].slice(-3) };
}

function lastOffTopic(messages: Message[]): string[] {
  return messages
    .filter((m) => m.from === "customer" && m.label === "off_topic")
    .slice(-2)
    .map((m) => m.text);
}

/**
 * A customer message the bot does not classify: the chat is paused, or the
 * message is a voice note / photo. It still lands in the inbox.
 */
export function receiveUnclassified(chat: Chat, text: string, kind: Message["kind"], now: number): Chat {
  const customer = msg("customer", text, now, { kind });
  const next: Chat = { ...chat, messages: [...chat.messages, customer] };
  if (kind === "voice" || kind === "photo") {
    next.needs_person = flag(chat, "Voice/photo", kind === "voice" ? "Голосовое сообщение" : "Фото");
  }
  return next;
}

/** Apply the classifier/reply decision for a customer text message on an unpaused chat. */
export function receiveClassified(
  chat: Chat,
  text: string,
  decision: ReplyDecision,
  type: BusinessType,
  now: number,
): Chat {
  const customer = msg("customer", text, now, { label: decision.label, path: decision.path });
  const messages = [...chat.messages, customer];
  const next: Chat = { ...chat, messages };
  const bot = (t: string) => messages.push(msg("bot", t, now + 1, { path: decision.path }));

  if (decision.label === "off_topic") {
    next.off_topic_count = chat.off_topic_count + 1;
    if (chat.ai_stopped) {
      // AI already stopped: no reply, keep the badge current.
      next.needs_person = { reason: "Off-topic", details: lastOffTopic(messages) };
    } else if (next.off_topic_count >= 2) {
      bot(HANDOFF_LINE);
      messages.push(msg("system", "Handed to a person: off-topic twice. AI stopped on this chat.", now + 2));
      next.ai_stopped = true;
      next.needs_person = { reason: "Off-topic", details: lastOffTopic(messages) };
    } else {
      bot(offTopicLine(type));
    }
    return next;
  }

  if (decision.label === "greeting") {
    // Greetings never change the count, and get no reply while AI is stopped.
    if (!chat.ai_stopped && decision.reply) bot(decision.reply);
    return next;
  }

  // On-topic: reset the count and let the bot answer again.
  next.off_topic_count = 0;
  next.ai_stopped = false;

  if (decision.missing || !decision.reply) {
    bot(MISSING_ANSWER_LINE);
    next.needs_person = flag(chat, "Missing answer", text);
    return next;
  }

  bot(decision.reply);
  if (decision.label === "booking" || decision.label === "order") {
    next.needs_person = flag(chat, "Booking/order", text);
  }
  return next;
}

/** A staff reply, typed in the inbox or mirrored from the WhatsApp Business app (echo). */
export function staffReply(chat: Chat, text: string, now: number, source: "inbox" | "echo" = "inbox"): Chat {
  const staff = msg("staff", text, now);
  const note = msg(
    "system",
    source === "echo" ? "Reply sent from the WhatsApp Business app. Bot paused for 30 min." : "Bot paused for 30 min.",
    now + 1,
  );
  return {
    ...chat,
    messages: [...chat.messages, staff, note],
    paused_until: now + PAUSE_MS,
    needs_person: null,
  };
}

export function resumeBot(chat: Chat, now: number): Chat {
  return {
    ...chat,
    paused_until: null,
    messages: [...chat.messages, msg("system", "Bot resumed by the owner.", now)],
  };
}

/** Demo only: move this chat's pause timer forward by 30 minutes. */
export function skipThirtyMinutes(chat: Chat, now: number): Chat {
  if (chat.paused_until === null) return chat;
  const until = chat.paused_until - PAUSE_MS;
  return {
    ...chat,
    paused_until: until > now ? until : null,
    messages: until > now ? chat.messages : [...chat.messages, msg("system", "Pause ended. Bot answers the next message.", now)],
  };
}

/** Staff opened the chat: the "Needs a person" badge has been seen. */
export function openChat(chat: Chat): Chat {
  return chat.needs_person ? { ...chat, needs_person: null } : chat;
}

export function formatLeft(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
