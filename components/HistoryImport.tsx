"use client";

import Link from "next/link";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { useT } from "@/lib/i18n/react";

type State =
  | { kind: "idle" }
  | { kind: "reading" }
  | { kind: "done"; chats: number; added: number }
  | { kind: "empty" }
  | { kind: "error"; text: string };

/**
 * "Learn from your WhatsApp chats": reads the chats the owner shared when
 * connecting, and sends them to check the facts it found.
 */
export function HistoryImport() {
  const { refresh } = useStore();
  const { t, tError } = useT();
  const [state, setState] = useState<State>({ kind: "idle" });

  const read = async () => {
    setState({ kind: "reading" });
    const res = await fetch("/api/whatsapp/history", { method: "POST" }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as { status?: string; chats?: number; added?: number; error?: string } | undefined;
    if (!res?.ok || !body?.status) return setState({ kind: "error", text: body?.error ? tError(body.error) : t("generic_error") });
    if (body.status === "empty") return setState({ kind: "empty" });
    await refresh();
    setState({ kind: "done", chats: body.chats ?? 0, added: body.added ?? 0 });
  };

  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>{t("hist_title")}</h2>
      {state.kind === "idle" ? <p className="muted" style={{ margin: 0 }}>{t("hist_body")}</p> : null}
      {state.kind === "reading" ? (
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <div className="spinner" aria-hidden="true" style={{ margin: 0, flex: "none", width: 24, height: 24, borderWidth: 3 }} />
          <p className="muted" style={{ margin: 0 }}>{t("hist_reading")}</p>
        </div>
      ) : null}
      {state.kind === "done" ? (
        <p style={{ margin: 0 }}>{t(state.added > 0 ? "hist_done" : "hist_none_new", { n: state.chats, k: state.added })}</p>
      ) : null}
      {state.kind === "empty" ? <div className="notice small" style={{ margin: 0 }}>{t("hist_empty")}</div> : null}
      {state.kind === "error" ? <div className="notice warn small" style={{ margin: 0 }}>{state.text}</div> : null}

      {state.kind === "done" && state.added > 0 ? (
        <Link href="/review" className="btn primary block">{t("hist_check")}</Link>
      ) : state.kind !== "reading" ? (
        <button className={state.kind === "idle" ? "primary block" : "block"} onClick={read}>
          {t(state.kind === "idle" ? "hist_btn" : "hist_again")}
        </button>
      ) : null}
    </div>
  );
}
