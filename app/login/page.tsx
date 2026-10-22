"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { useT } from "@/lib/i18n/react";

export default function LoginPage() {
  const router = useRouter();
  const { refresh } = useStore();
  const { t, tError } = useT();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      // A crashed server sends no JSON; say so instead of a parsing error.
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ? tError(body.error) : t("server_error", { status: res.status }));
      await refresh();
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("generic_error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page narrow">
      <form className="card stack" onSubmit={submit}>
        <h1>{t(mode === "login" ? "login_title" : "signup_title")}</h1>
        <p className="muted">{t("login_tagline")}</p>
        <label className="field">
          <span>{t("email")}</span>
          <input type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>{t("password")}{mode === "signup" ? t("password_min") : ""}</span>
          <input
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            minLength={mode === "signup" ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error ? <div className="notice warn small" style={{ margin: 0 }}>{error}</div> : null}
        <button className="primary block" disabled={busy}>
          {busy ? "…" : t(mode === "login" ? "login_btn" : "signup_btn")}
        </button>
        <button
          type="button"
          className="ghost block"
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login");
            setError(null);
          }}
        >
          {t(mode === "login" ? "to_signup" : "to_login")}
        </button>
      </form>
    </main>
  );
}
