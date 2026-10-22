"use client";

import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/lib/store";

interface NumberInfo {
  id: string;
  name: string | null;
  sandbox: boolean;
  business_app: boolean;
}

/** Settings → WhatsApp: connect this business to a number in the Kapso project. */
export function WhatsAppSettings() {
  const { business, refresh } = useStore();
  const [info, setInfo] = useState<{ available: boolean; connected: string | null; numbers: NumberInfo[]; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/whatsapp");
    setInfo(res.ok ? await res.json() : { available: false, connected: null, numbers: [] });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const connect = async (id: string | null) => {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/whatsapp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    const body = (await res.json()) as { error?: string };
    if (!res.ok) setError(body.error ?? "Could not connect.");
    await load();
    await refresh();
    setBusy(false);
  };

  if (!info) return <div className="card"><h2>WhatsApp</h2><p className="muted">Loading…</p></div>;

  return (
    <div className="card stack">
      <h2>WhatsApp</h2>
      {!info.available ? (
        <p className="muted">WhatsApp isn&apos;t set up on this server yet (no Kapso API key).</p>
      ) : (
        <>
          <p className="muted">
            Customers who write to the connected number get answers from the bot
            {business?.live ? "." : " once you go live. Until then their messages wait in the inbox."}
            {" "}Messages from before the connection are never answered.
          </p>
          {info.error ? <div className="notice warn small" style={{ margin: 0 }}>{info.error}</div> : null}
          {info.numbers.length === 0 ? <p className="muted">No numbers in the Kapso project yet.</p> : null}
          {info.numbers.map((n) => {
            const on = info.connected === n.id;
            return (
              <div key={n.id} className="fact row between">
                <div>
                  <strong>{n.name ?? n.id}</strong>{" "}
                  {n.sandbox ? <span className="badge plain">sandbox</span> : null}
                  {n.business_app ? <span className="badge wa-badge">WhatsApp Business app</span> : null}
                  {on ? <span className="badge ok" style={{ marginLeft: 4 }}>connected</span> : null}
                  {n.sandbox ? <div className="small muted">For testing: write to it from a phone you added in Kapso → WhatsApp → Sandbox.</div> : null}
                </div>
                <button className={on ? "ghost" : "primary"} disabled={busy || (!!info.connected && !on)} onClick={() => connect(on ? null : n.id)}>
                  {on ? "Disconnect" : "Connect"}
                </button>
              </div>
            );
          })}
          {error ? <div className="notice warn small" style={{ margin: 0 }}>{error}</div> : null}
        </>
      )}
    </div>
  );
}
