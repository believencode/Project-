"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useStore } from "@/lib/store";

/** Logged-out visitors go to /login; while loading, a spinner. Shows request errors in a banner. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { ready, user, error, clearError } = useStore();
  const path = usePathname();
  const router = useRouter();
  const onLogin = path === "/login";

  useEffect(() => {
    if (!ready) return;
    if (!user && !onLogin) router.replace("/login");
    if (user && onLogin) router.replace("/");
  }, [ready, user, onLogin, router]);

  if (!ready || (!user && !onLogin) || (user && onLogin)) {
    return (
      <main className="page narrow">
        <div className="spinner" aria-label="Loading" />
      </main>
    );
  }
  return (
    <>
      {error ? (
        <div className="error-bar" role="alert">
          <span>{error}</span>
          <button className="ghost small" onClick={clearError} aria-label="Dismiss">✕</button>
        </div>
      ) : null}
      {children}
    </>
  );
}
