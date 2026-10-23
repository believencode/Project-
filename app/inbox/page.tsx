"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useNow, useStore } from "@/lib/store";
import { ChatBadges, ChatThread, customerName } from "@/components/ChatThread";
import { NeedsBusiness } from "@/components/NeedsBusiness";
import type { NeedsPerson } from "@/lib/types";
import { useT } from "@/lib/i18n/react";

function Inbox() {
  const { business, open, sendCustomer } = useStore();
  const params = useSearchParams();
  const router = useRouter();
  const { t } = useT();
  const now = useNow();
  // The open chat lives in the address, so the phone's back button returns to the list.
  const selected = params.get("chat");
  const open_ = (id: string | null) => router.push(id ? `/inbox?chat=${encodeURIComponent(id)}` : "/inbox");
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
    <div className={`inbox ${current ? "has-chat" : ""}`}>
      <div className="list">
        {sorted.map((c) => {
          const last = [...c.messages].reverse().find((m) => m.from !== "system");
          return (
            <button key={c.id} className={`chat-item ${c.id === selected ? "on" : ""}`} onClick={() => {
                // Opening a chat means staff have seen it: clear "Needs a person".
                open_(c.id);
                setSeen(c.needs_person ? { chatId: c.id, flag: c.needs_person } : null);
                if (c.needs_person) void open(c.id);
              }}>
              <div className="top">
                <span>
                  {customerName(c, t)}
                  {c.is_whatsapp ? <span className="badge wa-badge" style={{ marginLeft: 6 }}>WhatsApp</span> : null}
                </span>
                <span className="muted small">{last ? new Date(last.at).toLocaleDateString("ru-RU") : ""}</span>
              </div>
              <div className="preview">
                {last ? `${last.from === "bot" ? t("bot_prefix") : last.from === "staff" ? t("staff_prefix") : ""}${last.kind === "voice" ? t("voice_message") : last.text}` : t("no_messages")}
              </div>
              <div className="badges"><ChatBadges chat={c} now={now} /></div>
            </button>
          );
        })}
      </div>
      <div className="thread">
        {current ? (
          <>
            <ChatThread chat={current} seen={seen?.chatId === current.id ? seen.flag : null} onBack={() => open_(null)} />
            {/* Demo only: write as the test customer. Real chats are written by real customers. */}
            {!current.is_test ? null : (
              <SimulateCustomer onSend={(t) => void sendCustomer(current.id, t)} onVoice={() => void sendCustomer(current.id, "", "voice")} />
            )}
          </>
        ) : (
          <div className="messages" style={{ alignItems: "center", justifyContent: "center" }}>
            <div className="sys">{t("pick_chat")}</div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Demo control: send a message as this customer. */
function SimulateCustomer({ onSend, onVoice }: { onSend: (t: string) => void; onVoice: () => void }) {
  const [text, setText] = useState("");
  const { t } = useT();
  const send = () => {
    if (!text.trim()) return;
    onSend(text.trim());
    setText("");
  };
  return (
    <div className="composer" style={{ borderTop: "1px dashed var(--line)" }}>
      <input type="text" value={text} placeholder={t("demo_customer_ph")} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
      <button onClick={send} disabled={!text.trim()}>{t("as_customer")}</button>
      <button onClick={onVoice} title={t("voice_title")}>🎤</button>
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
