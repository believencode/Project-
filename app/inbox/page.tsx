"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useNow, useStore } from "@/lib/store";
import { ChatBadges, ChatThread } from "@/components/ChatThread";
import { NeedsBusiness } from "@/components/NeedsBusiness";
import type { NeedsPerson } from "@/lib/types";

function Inbox() {
  const { business, open, sendCustomer } = useStore();
  const params = useSearchParams();
  const now = useNow();
  const [selected, setSelected] = useState<string | null>(params.get("chat"));
  // What the chat was waiting for when staff opened it, so the reason stays visible.
  const [seen, setSeen] = useState<{ chatId: string; flag: NeedsPerson } | null>(null);

  const chats = business?.chats ?? [];
  const sorted = [...chats].sort((a, b) => {
    const wa = a.needs_person ? 1 : 0, wb = b.needs_person ? 1 : 0;
    if (wa !== wb) return wb - wa;
    return (b.messages.at(-1)?.at ?? 0) - (a.messages.at(-1)?.at ?? 0);
  });
  const current = chats.find((c) => c.id === selected) ?? null;

  if (!business) return <NeedsBusiness />;

  return (
    <div className="inbox">
      <div className="list">
        {sorted.map((c) => {
          const last = [...c.messages].reverse().find((m) => m.from !== "system");
          return (
            <button key={c.id} className={`chat-item ${c.id === selected ? "on" : ""}`} onClick={() => {
                // Opening a chat means staff have seen it: clear "Needs a person".
                setSelected(c.id);
                setSeen(c.needs_person ? { chatId: c.id, flag: c.needs_person } : null);
                open(c.id);
              }}>
              <div className="top">
                <span>{c.customer}</span>
                <span className="muted small">{last ? new Date(last.at).toLocaleDateString("ru-RU") : ""}</span>
              </div>
              <div className="preview">
                {last ? `${last.from === "bot" ? "Bot: " : last.from === "staff" ? "Staff: " : ""}${last.kind === "voice" ? "🎤 Voice message" : last.text}` : "No messages"}
              </div>
              <div className="badges"><ChatBadges chat={c} now={now} /></div>
            </button>
          );
        })}
      </div>
      <div className="thread">
        {current ? (
          <>
            <ChatThread chat={current} seen={seen?.chatId === current.id ? seen.flag : null} />
            <SimulateCustomer onSend={(t) => sendCustomer(current.id, t)} onVoice={() => sendCustomer(current.id, "", "voice")} />
          </>
        ) : (
          <div className="messages" style={{ alignItems: "center", justifyContent: "center" }}>
            <div className="sys">Pick a chat</div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Demo control: send a message as this customer. */
function SimulateCustomer({ onSend, onVoice }: { onSend: (t: string) => void; onVoice: () => void }) {
  const [t, setT] = useState("");
  const send = () => {
    if (!t.trim()) return;
    onSend(t.trim());
    setT("");
  };
  return (
    <div className="composer" style={{ borderTop: "1px dashed var(--line)" }}>
      <input type="text" value={t} placeholder="Demo: message from this customer" onChange={(e) => setT(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
      <button onClick={send} disabled={!t.trim()}>As customer</button>
      <button onClick={onVoice} title="Send a voice note as this customer">🎤</button>
    </div>
  );
}

export default function InboxPage() {
  return (
    <Suspense>
      <Inbox />
    </Suspense>
  );
}
