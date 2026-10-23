"use client";

import { useEffect, useRef, useState } from "react";
import type { Chat, Message, NeedsPerson, NeedsPersonReason, Slot, SystemNote } from "@/lib/types";
import { formatLeft, isPaused } from "@/lib/engine";
import { useNow, useStore } from "@/lib/store";
import { useT } from "@/lib/i18n/react";
import type { Key, Vars } from "@/lib/i18n";

type T = (key: Key, vars?: Vars) => string;

export const REASON: Record<NeedsPersonReason, Key> = {
  "Off-topic": "reason_off_topic",
  "Missing answer": "reason_missing",
  "Voice/photo": "reason_voice",
  "Booking/order": "reason_booking",
  "AI unavailable": "reason_ai",
};

export const SLOT: Record<Slot, Key> = { item: "slot_item", size: "slot_size", day: "slot_day", time: "slot_time", people: "slot_people" };

/** The customer's name as owners see it: the test chat is named in the owner's language. */
export function customerName(chat: Chat, t: T): string {
  return chat.is_test ? t("test_customer") : chat.customer;
}

function summarizeDraft(chat: Chat, t: T): string {
  const s = chat.draft?.slots ?? {};
  const parts = [s.item, s.size && t("size_n", { n: s.size }), s.people && t("people_n", { n: s.people }), s.day, s.time].filter(Boolean);
  return parts.length ? parts.join(", ") : t("nothing_yet");
}

/** System lines saved before notes existed only have English text. */
function legacyNote(text: string): SystemNote | null {
  if (text.startsWith("Handed to a person: off-topic twice")) return { code: "handoff_off_topic" };
  if (text === "Bot paused for 30 min.") return { code: "paused", echo: false };
  if (text.startsWith("Reply sent from the WhatsApp Business app")) return { code: "paused", echo: true };
  if (text === "Bot resumed by the owner.") return { code: "resumed" };
  if (text.startsWith("Pause ended.")) return { code: "pause_ended" };
  const settled = text.match(/^Staff (confirmed|declined): (.*)$/);
  if (settled) return { code: "settled", ok: settled[1] === "confirmed", summary: settled[2] };
  return null;
}

function systemText(m: Message, t: T): string {
  const note = m.note ?? legacyNote(m.text);
  if (!note) return m.text;
  switch (note.code) {
    case "handoff_off_topic":
      return t("sys_handoff");
    case "settled":
      return t(note.ok ? "sys_confirmed" : "sys_declined", { summary: note.summary });
    case "paused":
      return t(note.echo ? "sys_paused_echo" : "sys_paused");
    case "resumed":
      return t("sys_resumed");
    case "pause_ended":
      return t("sys_pause_ended");
  }
}

const time = (at: number) => new Date(at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function ChatBadges({ chat, now }: { chat: Chat; now: number }) {
  const { t } = useT();
  return (
    <>
      {chat.needs_person ? <span className="badge alert">{t("needs_person", { reason: t(REASON[chat.needs_person.reason]) })}</span> : null}
      {isPaused(chat, now) ? <span className="badge info">{t("staff_has", { left: formatLeft(chat.paused_until! - now) })}</span> : null}
      {chat.ai_stopped && !chat.needs_person ? <span className="badge plain">{t("ai_stopped")}</span> : null}
      {chat.off_topic_count > 0 ? <span className="badge plain">{t("off_topic_n", { n: chat.off_topic_count })}</span> : null}
      {chat.requests?.some((r) => r.status === "pending") ? <span className="badge check">{t("request_to_confirm")}</span> : null}
      {chat.draft ? <span className="badge plain">{t("collecting_kind", { kind: t(`kind_${chat.draft.kind}`) })}</span> : null}
    </>
  );
}

export function ChatThread({
  chat,
  composer = true,
  seen = null,
  onBack,
}: {
  chat: Chat;
  composer?: boolean;
  seen?: NeedsPerson | null;
  /** Phones: back to the chat list. */
  onBack?: () => void;
}) {
  const { sendStaff, resume, skip30, settle } = useStore();
  const { t } = useT();
  const now = useNow();
  const [draft, setDraft] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const paused = isPaused(chat, now);
  const flag = chat.needs_person ?? seen;
  const phone = chat.phone === "test" ? t("test_number") : chat.phone;

  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [chat.messages.length]);

  const send = () => {
    if (!draft.trim()) return;
    void sendStaff(chat.id, draft.trim(), "inbox");
    setDraft("");
  };

  return (
    <>
      <div className="thread-head">
        <div className="row between">
          <div>
            {onBack ? (
              <button className="ghost small back-to-list" onClick={onBack} style={{ paddingLeft: 0 }}>
                {t("back_to_chats")}
              </button>
            ) : null}
            <strong>{customerName(chat, t)}</strong>{" "}
            {chat.is_whatsapp ? <span className="badge wa-badge">WhatsApp</span> : null}{" "}
            <span className="muted small">{chat.phone !== "test" ? chat.phone : t("simulated")}</span>
          </div>
          <div className="row">
            {paused ? (
              <>
                <button className="small" onClick={() => skip30(chat.id)} title={t("demo_only")}>{t("skip30")}</button>
                <button className="small" onClick={() => resume(chat.id)}>{t("resume_bot")}</button>
              </>
            ) : null}
          </div>
        </div>
        <div className="row" style={{ marginTop: 6 }}>
          <ChatBadges chat={chat} now={now} />
          {!paused && !chat.ai_stopped ? <span className="badge ok">{t("bot_answering")}</span> : null}
        </div>
        {flag?.details.length ? (
          <div className="small muted" style={{ marginTop: 6 }}>
            {chat.needs_person ? "" : t("was_waiting", { reason: t(REASON[flag.reason]) })}
            {t(flag.reason === "Off-topic" ? "last_off_topic" : flag.reason === "Booking/order" ? "request_prefix" : "customer_asked")}
            {flag.details.map((d) => `«${d || "—"}»`).join(", ")}
          </div>
        ) : null}
        {chat.draft ? (
          <div className="small muted" style={{ marginTop: 6 }}>
            {t("bot_collecting", { kind: t(`kind_${chat.draft.kind}`), summary: summarizeDraft(chat, t) })}
            {chat.draft.asked ? t("waiting_for", { slot: t(SLOT[chat.draft.asked]) }) : ""}
          </div>
        ) : null}
        {chat.requests?.filter((r) => r.status === "pending").map((r) => (
          <div key={r.id} className="request">
            <div>
              <strong>{t(r.kind === "order" ? "kind_order_title" : "kind_booking_title")}:</strong> {r.summary}
              <div className="small muted">{customerName(chat, t)} · {phone}</div>
            </div>
            <div className="row">
              <button className="small" onClick={() => settle(chat.id, r.id, false)}>{t("decline")}</button>
              <button className="primary small" onClick={() => settle(chat.id, r.id, true)}>{t("confirm")}</button>
            </div>
          </div>
        ))}
      </div>

      <div className="messages">
        {chat.messages.length === 0 ? <div className="sys">{t("no_messages_yet")}</div> : null}
        {chat.messages.map((m) =>
          m.from === "system" ? (
            <div key={m.id} className="sys">{systemText(m, t)}</div>
          ) : (
            <div key={m.id} className={`bubble ${m.from}`}>
              {m.kind === "voice" ? <span>{t("voice_014")}</span> : m.kind === "photo" ? <span>{t("photo")}</span> : m.text}
              <div className="meta">
                <span>{m.from === "bot" ? t("bot") : m.from === "staff" ? t("staff") : ""}</span>
                {m.from === "bot" && m.written_by ? (
                  <span className={m.written_by === "ai" ? "badge ok" : "badge plain"}>{t(m.written_by === "ai" ? "ai" : "fixed_line")}</span>
                ) : null}
                {m.label ? <span className="badge plain">{t(`label_${m.label}`)}</span> : null}
                {m.delivery === "failed" ? <span className="badge alert">{t("not_delivered")}</span> : null}
                <span>{time(m.at)}</span>
              </div>
            </div>
          ),
        )}
        <div ref={end} />
      </div>

      {composer ? (
        <div className="composer">
          <input type="text" value={draft} placeholder={t(chat.is_whatsapp ? "reply_wa_ph" : "reply_staff_ph")} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
          <button className="primary" onClick={send} disabled={!draft.trim()}>{t("send")}</button>
        </div>
      ) : null}
      {composer ? <div className="small muted composer-hint">{t("staff_pause_hint")}</div> : null}
    </>
  );
}
