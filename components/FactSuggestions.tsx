"use client";

import { useState } from "react";
import type { Chat, FactSuggestion } from "@/lib/types";
import { pendingSuggestions } from "@/lib/knowledge";
import { useStore } from "@/lib/store";

/** Answers staff gave to questions the bot couldn't answer, offered as facts for the knowledge base. */
export function FactSuggestions() {
  const { business } = useStore();
  if (!business) return null;
  const pending = pendingSuggestions(business.chats);
  if (pending.length === 0) return null;
  return (
    <div className="card stack">
      <div>
        <h2>Learned from your staff</h2>
        <p className="muted small">
          The bot couldn&apos;t answer these questions, and your staff did. Add an answer and the bot will give it next time.
        </p>
      </div>
      {pending.map(({ chat, s }) => (
        <SuggestionCard key={`${chat.id}:${s.id}`} chat={chat} s={s} />
      ))}
    </div>
  );
}

function SuggestionCard({ chat, s }: { chat: Chat; s: FactSuggestion }) {
  const { settleSuggestion } = useStore();
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
        <span className="muted">{chat.customer} asked:</span> «{s.question}»
      </div>
      <div className="small">
        <span className="muted">Staff answered:</span> «{s.answer}»
      </div>
      <label className="field">
        <span>Topic</span>
        <input type="text" value={topic} placeholder="Доставка" onChange={(e) => setTopic(e.target.value)} />
      </label>
      <label className="field">
        <span>What the bot will know</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="row">
        <button className="primary" disabled={busy || !topic.trim() || !text.trim()} onClick={() => settle(true)}>
          Add to knowledge
        </button>
        <button className="ghost" disabled={busy} onClick={() => settle(false)}>Not useful</button>
      </div>
    </div>
  );
}
