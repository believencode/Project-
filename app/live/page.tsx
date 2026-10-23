"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReplyDecision } from "@/lib/types";
import { useNow, useStore } from "@/lib/store";
import { isPaused } from "@/lib/engine";
import { ChatThread } from "@/components/ChatThread";
import { NeedsBusiness } from "@/components/NeedsBusiness";
import { SLOT } from "@/components/ChatThread";
import { useT } from "@/lib/i18n/react";

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
  const { business, whatsapp, sendCustomer, sendStaff, resetTestChat } = useStore();
  const now = useNow();
  const { t } = useT();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<{ ai: boolean } | null>(null);
  useEffect(() => {
    fetch("/api/mode").then((r) => r.json()).then(setMode).catch(() => setMode({ ai: false }));
  }, []);
  const [last, setLast] = useState<{ text: string; decision: ReplyDecision | null; requestsBefore: number } | null>(null);

  if (!business) return <NeedsBusiness />;
  const chat = business.chats.find((c) => c.is_test);
  if (!chat) return null;
  const others = business.chats.filter((c) => !c.is_test && !c.imported);
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

  // First steps, ticked off as the owner does them; the card goes away when all are done.
  const steps = [
    { key: "start_wa" as const, done: Boolean(whatsapp), href: "/connect" },
    { key: "start_alerts" as const, done: Boolean(business.alerts?.phone), href: "/settings" },
    { key: "start_test" as const, done: chat.messages.some((m) => m.from === "customer"), href: null },
  ];

  return (
    <main className="page">
      <div className="card">
        <div className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
          <span className="status-dot" style={{ marginTop: 8 }} />
          <div className="stack" style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0 }}>{t("live_title")}</h1>
            {mode ? <span className={`badge wrap ${mode.ai ? "ok" : "check"}`}>{t(mode.ai ? "ai_badge" : "demo_badge")}</span> : null}
            <span className="muted small">
              {t("live_stats", {
                name: business.sheet.name,
                on: others.filter((c) => !isPaused(c, now)).length,
                total: others.length,
                need: business.chats.filter((c) => c.needs_person).length,
              })}
            </span>
            <Link href="/inbox" className="btn primary">{t("open_inbox")}</Link>
          </div>
        </div>
      </div>

      {steps.some((s) => !s.done) ? (
        <div className="card stack">
          <h2>{t("start_title")}</h2>
          {steps.map((s) => (
            <div key={s.key} className="row between" style={{ flexWrap: "nowrap" }}>
              <span>
                <span className={s.done ? "step-done" : "step-todo"} aria-hidden="true">{s.done ? "✓" : "○"}</span> {t(s.key)}
              </span>
              {!s.done && s.href ? (
                <Link href={s.href} className={s.href === "/connect" ? "btn primary small" : "btn small"}>
                  {t(s.href === "/connect" ? "start_connect" : "start_open")}
                </Link>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid2">
        <div className="card stack">
          <h2>{t("test_box")}</h2>
          <p className="muted small">{t("test_hint")}</p>

          <div className="row" style={{ flexWrap: "nowrap" }}>
            <input type="text" value={text} placeholder={t("customer_ph")} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send(text)} />
            <button className="primary" onClick={() => send(text)} disabled={busy || !text.trim()}>{t("send")}</button>
          </div>

          {last ? (
            <div className="result stack">
              <div>
                <span className="muted small">{t("message")} </span>«{last.text}»
              </div>
              <div>
                <span className="muted small">{t("reply")} </span>
                {last.decision ? (
                  botAfter ?? <em className="muted">{t("no_reply_ai_stopped")}</em>
                ) : (
                  <span className="muted">{t(paused ? "staff_has_chat" : chat.needs_person?.reason === "AI unavailable" ? "ai_unreachable" : "no_reply")}</span>
                )}
                {botMsg?.written_by ? (
                  <span className={botMsg.written_by === "ai" ? "badge ok" : "badge plain"} style={{ marginLeft: 6 }}>
                    {t(botMsg.written_by === "ai" ? "written_by_ai" : "fixed_line")}
                  </span>
                ) : null}
              </div>
              {(chat.requests?.length ?? 0) > last.requestsBefore ? <span className="badge ok">{t("request_created")}</span> : null}
              {last.decision ? (
                <details>
                  <summary className="small muted">{t("why_reply")}</summary>
                  <div className="row" style={{ marginTop: 6 }}>
                    <span className="badge info">{t("label_is", { label: t(`label_${last.decision.label}`) })}</span>
                    <span className="badge plain">{t("off_topic_n", { n: chat.off_topic_count })}</span>
                    {last.decision.missing ? <span className="badge check">{t("missing_answer")}</span> : null}
                    {last.decision.follow_up ? <span className="badge check">{t("follow_up_q")}</span> : null}
                    {last.decision.continues_draft ? <span className="badge plain">{t("answered_bots_q")}</span> : null}
                    {chat.draft ? (
                      <span className="badge plain">
                        {t("collecting", { kind: t(`kind_${chat.draft.kind}`), slot: chat.draft.asked ? t(SLOT[chat.draft.asked]) : "—" })}
                      </span>
                    ) : null}
                  </div>
                </details>
              ) : null}
            </div>
          ) : null}

          <details>
            <summary className="small muted">{t("examples")}</summary>
            <div className="stack" style={{ marginTop: 8 }}>
              <div className="script row">
                {script(business.sheet.type, business.sheet.prices[0]?.item).map((s) => (
                  <button key={s} onClick={() => send(s)} disabled={busy}>{s}</button>
                ))}
              </div>
              <div className="small muted">{t("memory_hint")}</div>
              <div className="script row">
                {script2(business.sheet.type).map((s, i) => (
                  <button key={s} onClick={() => send(s)} disabled={busy}>{i + 1}. {s}</button>
                ))}
              </div>
              <button onClick={() => sendStaff(chat.id, "Здравствуйте! Сейчас уточню.", "echo")}>{t("staff_reply_phone")}</button>
            </div>
          </details>

          <button className="ghost" onClick={() => { resetTestChat(); setLast(null); }}>{t("reset_test")}</button>
        </div>

        <div className="card" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 420, background: "var(--chat-bg)" }}>
          <ChatThread chat={chat} composer={false} />
        </div>
      </div>
    </main>
  );
}
