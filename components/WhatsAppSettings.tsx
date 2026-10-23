"use client";

import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { useT } from "@/lib/i18n/react";

interface NumberInfo {
  id: string;
  name: string | null;
  sandbox: boolean;
  business_app: boolean;
}

/** Settings → WhatsApp: connect this business to a number in the Kapso project. */
export function WhatsAppSettings() {
  const { business, refresh } = useStore();
  const { t, tError } = useT();
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
    if (!res.ok) setError(tError(body.error ?? "Could not connect."));
    await load();
    await refresh();
    setBusy(false);
  };

  if (!info) return <div className="card"><h2>WhatsApp</h2><p className="muted">{t("loading")}</p></div>;

  return (
    <div className="card stack">
      <h2>WhatsApp</h2>
      {!info.available ? (
        <p className="muted">{t("wa_not_setup")}</p>
      ) : (
        <>
          <p className="muted">
            {t(business?.live ? "wa_info_live" : "wa_info_not_live")} {t("wa_never_old")}
          </p>
          {info.error ? <div className="notice warn small" style={{ margin: 0 }}>{tError(info.error)}</div> : null}
          {info.numbers.length === 0 ? <p className="muted">{t("wa_no_numbers")}</p> : null}
          {info.numbers.map((n) => {
            const on = info.connected === n.id;
            return (
              <div key={n.id} className="fact row between">
                <div>
                  <strong>{n.name ?? n.id}</strong>{" "}
                  {n.sandbox ? <span className="badge plain">{t("sandbox")}</span> : null}
                  {n.business_app ? <span className="badge wa-badge">{t("wa_business_app")}</span> : null}
                  {on ? <span className="badge ok" style={{ marginLeft: 4 }}>{t("connected")}</span> : null}
                  {n.sandbox ? <div className="small muted">{t("sandbox_hint")}</div> : null}
                </div>
                <button className={on ? "ghost" : "primary"} disabled={busy || (!!info.connected && !on)} onClick={() => connect(on ? null : n.id)}>
                  {t(on ? "disconnect" : "connect")}
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
