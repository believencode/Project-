"use client";

import Link from "next/link";
import { useStore } from "@/lib/store";
import { NeedsBusiness } from "@/components/NeedsBusiness";

const STATUS = { pending: "badge check", confirmed: "badge ok", declined: "badge plain" } as const;

export default function RequestsPage() {
  const { business, settle } = useStore();
  if (!business) return <NeedsBusiness />;

  const rows = business.chats
    .flatMap((c) => (c.requests ?? []).map((r) => ({ chat: c, r })))
    .sort((a, b) => (a.r.status === "pending" ? 0 : 1) - (b.r.status === "pending" ? 0 : 1) || b.r.created_at - a.r.created_at);

  return (
    <main className="page">
      <h1>Bookings and orders</h1>
      <p className="muted">The bot collects the details. Confirm or decline in one tap — the bot tells the customer.</p>
      {rows.length === 0 ? (
        <div className="card muted">
          No requests yet. On the Live screen, try «Хочу заказать белые кроссовки» or «Хочу забронировать столик».
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="facts">
            <thead>
              <tr>
                <th style={{ paddingLeft: 16 }}>Customer</th>
                <th>Type</th>
                <th>Details</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ chat, r }) => (
                <tr key={r.id}>
                  <td style={{ paddingLeft: 16 }}>
                    <Link href={`/inbox?chat=${chat.id}`}>{chat.customer}</Link>
                    <div className="small muted">{chat.phone === "test" ? "test number" : chat.phone}</div>
                  </td>
                  <td>{r.kind === "order" ? "Order" : "Booking"}</td>
                  <td>{r.summary}</td>
                  <td><span className={STATUS[r.status]}>{r.status}</span></td>
                  <td>
                    {r.status === "pending" ? (
                      <div className="row" style={{ flexWrap: "nowrap" }}>
                        <button className="small" onClick={() => settle(chat.id, r.id, false)}>Decline</button>
                        <button className="primary small" onClick={() => settle(chat.id, r.id, true)}>Confirm</button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
