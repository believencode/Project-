"use client";

import { useEffect, useState } from "react";
import type { AlertSettings as Alerts } from "@/lib/types";
import { useT } from "@/lib/i18n/react";

/** Settings → Alerts: the owner's WhatsApp number for "a customer needs a person". */
export function AlertSettings() {
  const { t, tError, lang } = useT();
  const [phone, setPhone] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [template, setTemplate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/alerts")
      .then((r) => r.json())
      .then((b: { alerts: Alerts | null; template: boolean }) => {
        if (b.alerts) {
          setPhone(`+${b.alerts.phone}`);
          setEnabled(b.alerts.enabled);
        }
        setTemplate(b.template);
      })
      .catch(() => undefined);
  }, []);

  const call = async (method: "PUT" | "POST", body?: unknown) => {
    const res = await fetch("/api/alerts", {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const out = (await res.json().catch(() => ({}))) as { error?: string; alerts?: Alerts };
    if (!res.ok) throw new Error(out.error ? tError(out.error) : t("generic_error"));
    return out;
  };

  const save = async (next = enabled) => {
    setBusy(true);
    setNote(null);
    try {
      const out = await call("PUT", { phone, enabled: next, lang });
      if (out.alerts) setPhone(`+${out.alerts.phone}`);
      setNote({ ok: true, text: t("saved") });
    } catch (err) {
      setNote({ ok: false, text: err instanceof Error ? err.message : t("generic_error") });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setNote(null);
    try {
      await call("PUT", { phone, enabled, lang });
      await call("POST");
      setNote({ ok: true, text: t("alerts_test_sent") });
    } catch (err) {
      setNote({ ok: false, text: err instanceof Error ? err.message : t("generic_error") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card stack">
      <h2>{t("alerts_title")}</h2>
      <p className="muted">{t("alerts_hint")}</p>
      <label className="field">
        <span>{t("alerts_phone")}</span>
        <input type="tel" inputMode="tel" autoComplete="tel" value={phone} placeholder="+996 555 123 456" onChange={(e) => setPhone(e.target.value)} />
      </label>
      <label className="row" style={{ flexWrap: "nowrap", gap: 8 }}>
        <input
          type="checkbox"
          checked={enabled}
          style={{ width: "auto" }}
          onChange={(e) => {
            setEnabled(e.target.checked);
            if (phone.trim()) void save(e.target.checked);
          }}
        />
        <span>{t("alerts_on")}</span>
      </label>
      <div className="row">
        <button className="primary" disabled={busy || !phone.trim()} onClick={() => save()}>{t("save")}</button>
        <button disabled={busy || !phone.trim()} onClick={test}>{t("alerts_test")}</button>
      </div>
      {note ? <div className={`notice small ${note.ok ? "" : "warn"}`} style={{ margin: 0 }}>{note.text}</div> : null}
      {!template ? <p className="small muted" style={{ margin: 0 }}>{t("alerts_no_template")}</p> : null}
    </div>
  );
}
