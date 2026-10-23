"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useStore } from "@/lib/store";
import { useT } from "@/lib/i18n/react";

type State = { kind: "checking" } | { kind: "connected"; phone: string | null; name: string | null } | { kind: "pending" } | { kind: "error"; text: string };

/** How many times to ask before showing "almost done": Kapso can need a little while after Finish. */
const TRIES = 10;
const EVERY_MS = 3000;

/** Back from the setup page: connect the new number and say so. */
function Done() {
  const params = useSearchParams();
  const { refresh } = useStore();
  const { t, tError } = useT();
  const [state, setState] = useState<State>({ kind: "checking" });
  const phoneNumberId = params.get("phone_number_id");
  const shownPhone = params.get("display_phone_number");
  const tries = useRef(0);

  const check = useCallback(async () => {
    const res = await fetch("/api/whatsapp/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone_number_id: phoneNumberId }),
    });
    const body = (await res.json().catch(() => ({}))) as { status?: string; number?: { phone: string | null; name: string | null }; error?: string };
    if (!res.ok) return setState({ kind: "error", text: body.error ? tError(body.error) : t("generic_error") });
    if (body.status === "connected") {
      await refresh();
      return setState({ kind: "connected", phone: body.number?.phone ?? shownPhone, name: body.number?.name ?? null });
    }
    tries.current += 1;
    setState({ kind: tries.current >= TRIES ? "pending" : "checking" });
  }, [phoneNumberId, shownPhone, refresh, t, tError]);

  useEffect(() => {
    if (state.kind !== "checking") return;
    const timer = setTimeout(() => void check(), tries.current === 0 ? 0 : EVERY_MS);
    return () => clearTimeout(timer);
  }, [state, check]);

  if (state.kind === "connected") {
    return (
      <main className="page narrow">
        <div className="card stack success-card">
          <div className="success-mark" aria-hidden="true">✓</div>
          <h1 style={{ margin: 0 }}>{t("done_title")}</h1>
          {state.phone || state.name ? <strong>{[state.phone, state.name].filter(Boolean).join(" · ")}</strong> : null}
          <p className="muted" style={{ margin: 0 }}>{t("done_body")}</p>
        </div>
        <div className="notice small">{t("connect_14days")}</div>
        <Link href="/live" className="btn primary block">{t("done_next")}</Link>
      </main>
    );
  }
  if (state.kind === "pending" || state.kind === "error") {
    return (
      <main className="page narrow">
        <div className="card stack">
          <h1 style={{ margin: 0 }}>{state.kind === "error" ? t("failed_title") : t("done_pending_title")}</h1>
          <p className="muted" style={{ margin: 0 }}>{state.kind === "error" ? state.text : t("done_pending_body")}</p>
        </div>
        <button className="primary block" onClick={() => { tries.current = 0; setState({ kind: "checking" }); }}>{t("check_again")}</button>
        <Link href="/live" className="btn block" style={{ marginTop: 8 }}>{t("back")}</Link>
      </main>
    );
  }
  return (
    <main className="page narrow" style={{ textAlign: "center" }}>
      <div className="spinner" aria-hidden="true" />
      <p className="muted">{t("done_checking")}</p>
    </main>
  );
}

export default function DonePage() {
  return (
    <Suspense>
      <Done />
    </Suspense>
  );
}
