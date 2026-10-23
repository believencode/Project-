"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { useT } from "@/lib/i18n/react";

interface NumberInfo {
  id: string;
  name: string | null;
  phone: string | null;
  sandbox: boolean;
  business_app: boolean;
}

interface Info {
  available: boolean;
  connected: string | null;
  numbers: NumberInfo[];
  error?: string;
}

/**
 * Settings → WhatsApp. Not connected: one button to connect the owner's own number.
 * Connected: the number, and a way to disconnect (asked first). The shared test
 * number stays folded away for trying things out.
 */
export function WhatsAppSettings() {
  const { business, refresh } = useStore();
  const { t, tError } = useT();
  const [info, setInfo] = useState<Info | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/whatsapp");
    setInfo(res.ok ? await res.json() : { available: false, connected: null, numbers: [] });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const after = async (res: Response) => {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) setError(tError(body.error ?? "Could not connect."));
    await load();
    await refresh();
    setBusy(false);
  };

  const connect = async (id: string | null) => {
    setBusy(true);
    setError(null);
    setConfirmOff(false);
    await after(await fetch("/api/whatsapp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }));
  };

  /** "Already connected?": the owner finished on the setup page but didn't come back through it. */
  const check = async () => {
    setBusy(true);
    setError(null);
    await after(await fetch("/api/whatsapp/complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }));
  };

  if (!info) return <div className="card"><h2>WhatsApp</h2><p className="muted">{t("loading")}</p></div>;
  if (!info.available) return <div className="card stack"><h2>WhatsApp</h2><p className="muted">{t("wa_not_setup")}</p></div>;

  const current = info.numbers.find((n) => n.id === info.connected);
  const tests = info.numbers.filter((n) => n.sandbox);

  return (
    <div className="card stack">
      <h2>WhatsApp</h2>
      {info.error ? <div className="notice warn small" style={{ margin: 0 }}>{tError(info.error)}</div> : null}

      {info.connected ? (
        <>
          <div className="fact row between" style={{ flexWrap: "nowrap" }}>
            <div>
              <strong>{current?.phone ?? current?.name ?? info.connected}</strong>
              {current?.phone && current.name ? <div className="small muted">{current.name}</div> : null}
            </div>
            <span className="badge ok">{t("connected")}</span>
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            {t(business?.live ? "wa_info_live" : "wa_info_not_live")} {t("wa_never_old")}
          </p>
          {confirmOff ? (
            <div className="notice warn">
              <p>{t("wa_disconnect_q")}</p>
              <div className="row">
                <button className="ghost" onClick={() => setConfirmOff(false)}>{t("cancel")}</button>
                <button className="danger" disabled={busy} onClick={() => connect(null)}>{t("disconnect")}</button>
              </div>
            </div>
          ) : (
            <button className="danger" disabled={busy} onClick={() => setConfirmOff(true)}>{t("disconnect")}</button>
          )}
        </>
      ) : (
        <>
          <p className="muted" style={{ margin: 0 }}>{t("wa_not_connected")}</p>
          <Link href="/connect" className="btn primary block">{t("wa_connect_btn")}</Link>
          <button className="ghost" disabled={busy} onClick={check}>{t("wa_check")}</button>
        </>
      )}

      {tests.length > 0 && !info.connected ? (
        <details>
          <summary className="small muted">{t("wa_test_numbers")}</summary>
          {tests.map((n) => (
            <div key={n.id} className="fact row between" style={{ marginTop: 8 }}>
              <div>
                <strong>{n.name ?? n.id}</strong> <span className="badge plain">{t("sandbox")}</span>
                <div className="small muted">{t("sandbox_hint")}</div>
              </div>
              <button disabled={busy} onClick={() => connect(n.id)}>{t("connect")}</button>
            </div>
          ))}
        </details>
      ) : null}
      {error ? <div className="notice warn small" style={{ margin: 0 }}>{error}</div> : null}
    </div>
  );
}
