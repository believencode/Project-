"use client";

import { useEffect, useRef, useState } from "react";
import type { Chat, NeedsPerson } from "@/lib/types";
import { formatLeft, isPaused } from "@/lib/engine";
import { useNow, useStore } from "@/lib/store";

function summarizeDraft(chat: Chat): string {
  const s = chat.draft?.slots ?? {};
  const parts = [s.item, s.size && `size ${s.size}`, s.people && `${s.people} people`, s.day, s.time].filter(Boolean);
  return parts.length ? parts.join(", ") : "nothing yet";
}

const time = (at: number) => new Date(at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function ChatBadges({ chat, now }: { chat: Chat; now: number }) {
  return (
    <>
      {chat.needs_person ? <span className="badge alert">Needs a person · {chat.needs_person.reason}</span> : null}
      {isPaused(chat, now) ? <span className="badge info">Staff has this chat · {formatLeft(chat.paused_until! - now)}</span> : null}
      {chat.ai_stopped && !chat.needs_person ? <span className="badge plain">AI stopped</span> : null}
      {chat.off_topic_count > 0 ? <span className="badge plain">off-topic {chat.off_topic_count}/2</span> : null}
      {chat.requests?.some((r) => r.status === "pending") ? <span className="badge check">Request to confirm</span> : null}
      {chat.draft ? <span className="badge plain">Collecting {chat.draft.kind}</span> : null}
    </>
  );
}

export function ChatThread({ chat, composer = true, seen = null }: { chat: Chat; composer?: boolean; seen?: NeedsPerson | null }) {
  const { sendStaff, resume, skip30, settle } = useStore();
  const now = useNow();
  const [draft, setDraft] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const paused = isPaused(chat, now);
  const flag = chat.needs_person ?? seen;

  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [chat.messages.length]);

  const send = () => {
    if (!draft.trim()) return;
    sendStaff(chat.id, draft.trim(), "inbox");
    setDraft("");
  };

  return (
    <>
      <div className="thread-head">
        <div className="row between">
          <div>
            <strong>{chat.customer}</strong> <span className="muted small">{chat.phone !== "test" ? chat.phone : "simulated customer"}</span>
          </div>
          <div className="row">
            {paused ? (
              <>
                <button className="small" onClick={() => skip30(chat.id)} title="Demo only">Skip 30 min</button>
                <button className="small" onClick={() => resume(chat.id)}>Resume bot</button>
              </>
            ) : null}
          </div>
        </div>
        <div className="row" style={{ marginTop: 6 }}>
          <ChatBadges chat={chat} now={now} />
          {!paused && !chat.ai_stopped ? <span className="badge ok">Bot is answering</span> : null}
        </div>
        {flag?.details.length ? (
          <div className="small muted" style={{ marginTop: 6 }}>
            {chat.needs_person ? "" : `Was waiting for a person (${flag.reason}). `}
            {flag.reason === "Off-topic" ? "Last off-topic messages: " : flag.reason === "Booking/order" ? "Request: " : "Customer asked: "}
            {flag.details.map((d) => `«${d || "—"}»`).join(", ")}
          </div>
        ) : null}
        {chat.draft ? (
          <div className="small muted" style={{ marginTop: 6 }}>
            Bot is collecting a {chat.draft.kind}: {summarizeDraft(chat)}
            {chat.draft.asked ? ` · waiting for ${chat.draft.asked}` : ""}
          </div>
        ) : null}
        {chat.requests?.filter((r) => r.status === "pending").map((r) => (
          <div key={r.id} className="request">
            <div>
              <strong>{r.kind === "order" ? "Order" : "Booking"}:</strong> {r.summary}
              <div className="small muted">{chat.customer} · {chat.phone === "test" ? "test number" : chat.phone}</div>
            </div>
            <div className="row">
              <button className="small" onClick={() => settle(chat.id, r.id, false)}>Decline</button>
              <button className="primary small" onClick={() => settle(chat.id, r.id, true)}>Confirm</button>
            </div>
          </div>
        ))}
      </div>

      <div className="messages">
        {chat.messages.length === 0 ? <div className="sys">No messages yet</div> : null}
        {chat.messages.map((m) =>
          m.from === "system" ? (
            <div key={m.id} className="sys">{m.text}</div>
          ) : (
            <div key={m.id} className={`bubble ${m.from}`}>
              {m.kind === "voice" ? <span>🎤 Voice message 0:14</span> : m.kind === "photo" ? <span>📷 Photo</span> : m.text}
              <div className="meta">
                <span>{m.from === "bot" ? "Bot" : m.from === "staff" ? "Staff" : ""}</span>
                {m.label ? <span className="badge plain">{m.label}</span> : null}
                <span>{time(m.at)}</span>
              </div>
            </div>
          ),
        )}
        <div ref={end} />
      </div>

      {composer ? (
        <div className="composer">
          <input type="text" value={draft} placeholder="Reply as staff (pauses the bot for 30 min)" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
          <button className="primary" onClick={send} disabled={!draft.trim()}>Send</button>
        </div>
      ) : null}
    </>
  );
}
