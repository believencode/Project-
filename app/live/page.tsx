"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReplyDecision } from "@/lib/types";
import { useNow, useStore } from "@/lib/store";
import { isPaused } from "@/lib/engine";
import { ChatThread } from "@/components/ChatThread";
import { NeedsBusiness } from "@/components/NeedsBusiness";

function script(type: string, firstItem: string | undefined): string[] {
  if (type === "cafe") {
    return ["Здравствуйте", `Сколько стоит ${(firstItem ?? "лагман").toLowerCase()}?`, "Есть свободный столик на 4?", "Напиши сочинение", "Расскажи анекдот"];
  }
  return ["Здравствуйте", "Сколько стоят белые кроссовки?", "Какой размер есть?", "Напиши сочинение", "Расскажи анекдот"];
}

/** Memory, follow-up questions and booking/order requests. */
function script2(type: string): string[] {
  if (type === "cafe") return ["Сколько стоит лагман?", "Хочу забронировать столик", "завтра в семь вечера", "нас 4"];
  return ["Сколько стоят белые кроссовки?", "а 42 есть?", "Хочу заказать", "42"];
}

export default function LivePage() {
  const { business, sendCustomer, sendStaff, resetTestChat } = useStore();
  const now = useNow();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<{ ai: boolean; model: string | null } | null>(null);
  useEffect(() => {
    fetch("/api/mode").then((r) => r.json()).then(setMode).catch(() => setMode({ ai: false, model: null }));
  }, []);
  const [last, setLast] = useState<{ text: string; decision: ReplyDecision | null; requestsBefore: number } | null>(null);

  if (!business) return <NeedsBusiness />;
  const chat = business.chats.find((c) => c.is_test);
  if (!chat) return null;
  const others = business.chats.filter((c) => !c.is_test);
  const paused = isPaused(chat, now);

  const send = async (t: string) => {
    if (!t.trim() || busy) return;
    setBusy(true);
    const requestsBefore = chat.requests?.length ?? 0;
    const decision = await sendCustomer(chat.id, t.trim());
    setLast({ text: t.trim(), decision, requestsBefore });
    setText("");
    setBusy(false);
  };

  // The bot reply (if any) that follows the latest customer message.
  const lastCustomer = chat.messages.findLastIndex((m) => m.from === "customer");
  const botMsg = chat.messages.slice(lastCustomer + 1).find((m) => m.from === "bot");
  const botAfter = botMsg?.text ?? null;

  return (
    <main className="page">
      <div className="card row between">
        <div className="row">
          <span className="status-dot" />
          <div>
            <h1 style={{ margin: 0 }}>Bot is answering</h1>
            {mode ? (
              mode.ai ? (
                <span className="badge ok">AI writes every reply · {mode.model}</span>
              ) : (
                <span className="badge check">Demo mode: keyword rules and fixed lines — set LLM_PROVIDER to turn on AI</span>
              )
            ) : null}
            <span className="muted small">
              {business.sheet.name} · {others.filter((c) => !isPaused(c, now)).length} of {others.length} chats on the bot ·{" "}
              {business.chats.filter((c) => c.needs_person).length} need a person
            </span>
          </div>
        </div>
        <Link href="/inbox" className="btn primary">Open inbox →</Link>
      </div>

      <div className="grid2">
        <div className="card stack">
          <h2>Test box</h2>
          <p className="muted small">Type as a customer. Messages go into the «Test customer» chat, which also shows in the inbox.</p>

          <div className="script row">
            {script(business.sheet.type, business.sheet.prices[0]?.item).map((s, i) => (
              <button key={s} onClick={() => send(s)} disabled={busy}>
                {i + 1}. {s}
              </button>
            ))}
          </div>

          <div>
            <div className="small muted" style={{ marginBottom: 6 }}>Memory, follow-ups and requests — tap in order:</div>
            <div className="script row">
              {script2(business.sheet.type).map((s, i) => (
                <button key={s} onClick={() => send(s)} disabled={busy}>
                  {String.fromCharCode(97 + i)}. {s}
                </button>
              ))}
            </div>
          </div>

          <div className="row" style={{ flexWrap: "nowrap" }}>
            <input type="text" value={text} placeholder="Сообщение клиента…" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send(text)} />
            <button className="primary" onClick={() => send(text)} disabled={busy || !text.trim()}>Send</button>
          </div>

          <div className="row">
            <button onClick={() => sendStaff(chat.id, "Здравствуйте! Сейчас уточню.", "echo")}>6. Staff reply (from phone)</button>
            <button className="ghost" onClick={() => { resetTestChat(); setLast(null); }}>Reset test chat</button>
          </div>

          {last ? (
            <div className="result stack">
              <div>
                <span className="muted small">Message </span>«{last.text}»
              </div>
              {last.decision ? (
                <>
                  <div className="row">
                    <span className="badge info">label: {last.decision.label}</span>
                    <span className="badge plain">off_topic_count: {chat.off_topic_count}</span>
                    <span className="badge plain">path: {last.decision.path}{last.decision.model ? ` · ${last.decision.model}` : ""}</span>
                    {last.decision.missing ? <span className="badge check">missing answer</span> : null}
                    {last.decision.follow_up ? <span className="badge check">follow-up question</span> : null}
                    {last.decision.continues_draft ? <span className="badge plain">answered the bot&apos;s question</span> : null}
                    {chat.draft ? <span className="badge plain">collecting {chat.draft.kind}: needs {chat.draft.asked}</span> : null}
                    {(chat.requests?.length ?? 0) > last.requestsBefore ? <span className="badge ok">request created → staff confirm</span> : null}
                  </div>
                  <div>
                    <span className="muted small">Reply: </span>
                    {botAfter ?? <em className="muted">no reply — AI stopped on this chat</em>}
                    {botMsg?.written_by ? (
                      <span className={botMsg.written_by === "ai" ? "badge ok" : "badge plain"} style={{ marginLeft: 6 }}>
                        {botMsg.written_by === "ai" ? "written by AI" : "fixed line"}
                      </span>
                    ) : null}
                  </div>
                </>
              ) : (
                <div>
                  <span className="badge info">not classified</span>{" "}
                  <span className="muted">{paused
                      ? "Staff has this chat, so the bot stays quiet."
                      : chat.needs_person?.reason === "AI unavailable"
                        ? "The AI couldn't be reached, so no canned reply was sent — the chat went to a person."
                        : "No reply."}</span>
                </div>
              )}
            </div>
          ) : null}
        </div>

        <div className="card" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 480, background: "var(--chat-bg)" }}>
          <ChatThread chat={chat} composer={false} />
        </div>
      </div>
    </main>
  );
}
