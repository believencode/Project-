"use client";

import { useState } from "react";
import type { Chat, FactSuggestion } from "@/lib/types";
import { pendingSuggestions } from "@/lib/knowledge";
import { useStore } from "@/lib/store";
import { useT } from "@/lib/i18n/react";
import { customerName } from "./ChatThread";

/** Answers staff gave to questions the bot couldn't answer, offered as facts for the knowledge base. */
export function FactSuggestions() {
  const { business } = useStore();
  const { t } = useT();
  if (!business) return null;
  const pending = pendingSuggestions(business.chats);
  if (pending.length === 0) return null;
  return (
    <div className="card stack">
      <div>
        <h2>{t("learned_title")}</h2>
        <p className="muted small">{t("learned_hint")}</p>
      </div>
      {pending.map(({ chat, s }) => (
        <SuggestionCard key={`${chat.id}:${s.id}`} chat={chat} s={s} />
      ))}
    </div>
  );
}

function SuggestionCard({ chat, s }: { chat: Chat; s: FactSuggestion }) {
  const { settleSuggestion } = useStore();
  const { t } = useT();
  const [topic, setTopic] = useState(s.topic);
  const [text, setText] = useState(s.text);
  const [busy, setBusy] = useState(false);
  const settle = async (add: boolean) => {
    setBusy(true);
    await settleSuggestion(chat.id, s.id, add ? { topic, text } : null);
    setBusy(false);
  };
  return (
    <div className="fact stack">
      <div className="small">
        <span className="muted">{t("asked", { name: customerName(chat, t) })}</span> «{s.question}»
      </div>
      <div className="small">
        <span className="muted">{t("staff_answered")}</span> «{s.answer}»
      </div>
      <label className="field">
        <span>{t("topic")}</span>
        <input type="text" value={topic} placeholder="Доставка" onChange={(e) => setTopic(e.target.value)} />
      </label>
      <label className="field">
        <span>{t("what_bot_knows")}</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="row">
        <button className="primary" disabled={busy || !topic.trim() || !text.trim()} onClick={() => settle(true)}>
          {t("add_to_knowledge")}
        </button>
        <button className="ghost" disabled={busy} onClick={() => settle(false)}>{t("not_useful")}</button>
      </div>
    </div>
  );
}
