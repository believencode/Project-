"use client";

import Link from "next/link";
import { useStore } from "@/lib/store";
import { NeedsBusiness } from "@/components/NeedsBusiness";
import { useT } from "@/lib/i18n/react";

const STATUS = { pending: "badge check", confirmed: "badge ok", declined: "badge plain" } as const;

export default function RequestsPage() {
  const { business, settle } = useStore();
  const { t } = useT();
  if (!business) return <NeedsBusiness />;

  const rows = business.chats
    .flatMap((c) => (c.requests ?? []).map((r) => ({ chat: c, r })))
    .sort((a, b) => (a.r.status === "pending" ? 0 : 1) - (b.r.status === "pending" ? 0 : 1) || b.r.created_at - a.r.created_at);

  return (
    <main className="page">
      <h1>{t("requests_title")}</h1>
      <p className="muted">{t("requests_hint")}</p>
      {rows.length === 0 ? (
        <div className="card muted">{t("no_requests")}</div>
      ) : (
        <div className="stack">
          {rows.map(({ chat, r }) => (
            <div key={r.id} className="card request-card">
              <div className="row between" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
                <div>
                  <div className="small muted">{t(r.kind === "order" ? "kind_order_title" : "kind_booking_title")} · {new Date(r.created_at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</div>
                  <div className="value">{r.summary}</div>
                  <div className="small">
                    <Link href={`/inbox?chat=${encodeURIComponent(chat.id)}`}>{chat.customer}</Link>{" "}
                    <span className="muted">{chat.phone === "test" ? t("test_number") : chat.phone}</span>
                    {chat.is_whatsapp ? <span className="badge wa-badge" style={{ marginLeft: 6 }}>WhatsApp</span> : null}
                  </div>
                </div>
                <span className={STATUS[r.status]}>{t(`status_${r.status}`)}</span>
              </div>
              {r.status === "pending" ? (
                <div className="row" style={{ marginTop: 10, flexWrap: "nowrap" }}>
                  <button className="block" onClick={() => settle(chat.id, r.id, false)}>{t("decline")}</button>
                  <button className="primary block" onClick={() => settle(chat.id, r.id, true)}>{t("confirm")}</button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
