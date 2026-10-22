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
  const { business, sendCustomer, sendStaff, resetTestChat } = useStore();
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
            <h1 style={{ margin: 0 }}>{t("live_title")}</h1>
            {mode ? (
              mode.ai ? (
                <span className="badge ok wrap">{t("ai_badge")}</span>
              ) : (
                <span className="badge check wrap">{t("demo_badge")}</span>
              )
            ) : null}
            <span className="muted small">
              {t("live_stats", {
                name: business.sheet.name,
                on: others.filter((c) => !isPaused(c, now)).length,
                total: others.length,
                need: business.chats.filter((c) => c.needs_person).length,
              })}
            </span>
          </div>
        </div>
        <Link href="/inbox" className="btn primary">{t("open_inbox")}</Link>
      </div>

      <div className="grid2">
        <div className="card stack">
          <h2>{t("test_box")}</h2>
          <p className="muted small">{t("test_hint")}</p>

          <div className="script row">
            {script(business.sheet.type, business.sheet.prices[0]?.item).map((s, i) => (
              <button key={s} onClick={() => send(s)} disabled={busy}>
                {i + 1}. {s}
              </button>
            ))}
          </div>

          <div>
            <div className="small muted" style={{ marginBottom: 6 }}>{t("memory_hint")}</div>
            <div className="script row">
              {script2(business.sheet.type).map((s, i) => (
                <button key={s} onClick={() => send(s)} disabled={busy}>
                  {String.fromCharCode(97 + i)}. {s}
                </button>
              ))}
            </div>
          </div>

          <div className="row" style={{ flexWrap: "nowrap" }}>
            <input type="text" value={text} placeholder={t("customer_ph")} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send(text)} />
            <button className="primary" onClick={() => send(text)} disabled={busy || !text.trim()}>{t("send")}</button>
          </div>

          <div className="row">
            <button onClick={() => sendStaff(chat.id, "Здравствуйте! Сейчас уточню.", "echo")}>{t("staff_reply_phone")}</button>
            <button className="ghost" onClick={() => { resetTestChat(); setLast(null); }}>{t("reset_test")}</button>
          </div>

          {last ? (
            <div className="result stack">
              <div>
                <span className="muted small">{t("message")} </span>«{last.text}»
              </div>
              {last.decision ? (
                <>
                  <div className="row">
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
                    {(chat.requests?.length ?? 0) > last.requestsBefore ? <span className="badge ok">{t("request_created")}</span> : null}
                  </div>
                  <div>
                    <span className="muted small">{t("reply")} </span>
                    {botAfter ?? <em className="muted">{t("no_reply_ai_stopped")}</em>}
                    {botMsg?.written_by ? (
                      <span className={botMsg.written_by === "ai" ? "badge ok" : "badge plain"} style={{ marginLeft: 6 }}>
                        {t(botMsg.written_by === "ai" ? "written_by_ai" : "fixed_line")}
                      </span>
                    ) : null}
                  </div>
                </>
              ) : (
                <div>
                  <span className="badge info">{t("not_classified")}</span>{" "}
                  <span className="muted">{t(paused ? "staff_has_chat" : chat.needs_person?.reason === "AI unavailable" ? "ai_unreachable" : "no_reply")}</span>
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
