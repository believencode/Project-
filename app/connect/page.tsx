"use client";

import Link from "next/link";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { useT } from "@/lib/i18n/react";
import type { Key } from "@/lib/i18n";
import { NeedsBusiness } from "@/components/NeedsBusiness";

const BROWSER: Key[] = ["step_1", "step_2", "step_3", "step_4", "step_5"];
const WHATSAPP: Key[] = ["step_6", "step_7", "step_8", "step_9"];
const BACK: Key[] = ["step_10", "step_11", "step_12"];

/**
 * Before the owner leaves for the setup page: what they need, the three parts,
 * and every step on request. The setup page opens in this tab, so "Finish"
 * brings them straight back to /connect/done.
 */
export default function ConnectPage() {
  const { business } = useStore();
  const { t, tError } = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!business) return <NeedsBusiness />;

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/whatsapp/setup", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !body.url) throw new Error(body.error ? tError(body.error) : t("generic_error"));
      window.location.assign(body.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("generic_error"));
      setBusy(false);
    }
  };

  const steps = (keys: Key[], first: number) =>
    keys.map((k, i) => (
      <li key={k} className="step">
        <b className="step-n">{first + i}</b>
        <span>{t(k)}</span>
      </li>
    ));

  return (
    <main className="page narrow">
      <Link href="/live" className="ghost small" style={{ textDecoration: "none" }}>{t("back")}</Link>
      <h1 style={{ marginTop: 8 }}>{t("connect_title")}</h1>
      <p className="muted">{t("connect_lead")}</p>

      <div className="card stack">
        <h2>{t("connect_need_title")}</h2>
        <div className="check-line">✓ {t("connect_need_app")}</div>
        <div className="check-line">✓ {t("connect_need_details")}</div>
      </div>

      <div className="card stack">
        <h2>{t("connect_parts_title")}</h2>
        <div className="part"><span className="badge info">{t("part_browser")}</span><span>{t("connect_part1")}</span></div>
        <div className="part"><span className="badge wa-badge">{t("part_whatsapp")}</span><span>{t("connect_part2")}</span></div>
        <div className="part"><span className="badge info">{t("part_browser")}</span><span>{t("connect_part3")}</span></div>
        <details>
          <summary className="small">{t("connect_steps")}</summary>
          <p className="small muted" style={{ marginTop: 8 }}>{t("connect_keep_open")}</p>
          <ol className="steps-list">{steps(BROWSER, 1)}</ol>
          <ol className="steps-list">{steps(WHATSAPP, 6)}</ol>
          <p className="small muted">{t("step_no_message")}</p>
          <ol className="steps-list">{steps(BACK, 10)}</ol>
        </details>
      </div>

      <div className="notice warn small">{t("connect_warn")}</div>
      <div className="notice small">{t("connect_14days")}</div>
      {error ? <div className="notice warn small">{error}</div> : null}
      <button className="primary block" onClick={start} disabled={busy}>
        {busy ? t("connect_opening") : t("connect_start")}
      </button>
    </main>
  );
}
