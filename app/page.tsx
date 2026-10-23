"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { demoBusiness, useStore } from "@/lib/store";
import { attachSources } from "@/lib/sources";
import { useT } from "@/lib/i18n/react";

export default function Home() {
  const { ready, business, setBusiness } = useStore();
  const router = useRouter();
  const { t } = useT();
  // A business that is already answering: go straight to it.
  const live = Boolean(business?.live);
  useEffect(() => {
    if (ready && live) router.replace("/live");
  }, [ready, live, router]);
  if (!ready || live) return null;

  return (
    <main className="page narrow">
      <div className="card stack">
        <h1>Jardamchy</h1>
        <p>{t("home_intro")}</p>
        {business ? (
          // Setup was started but not finished. Starting over is in Settings, behind a confirmation,
          // so one tap here can never delete the business.
          <>
            <div className="notice">
              <strong>{business.sheet.name}</strong> {t("home_not_live")}
            </div>
            <Link className="btn primary" href="/review">{t("home_continue")}</Link>
          </>
        ) : (
          <>
            <div className="row">
              <button className="primary" onClick={() => router.push("/setup")}>
                {t("home_setup")}
              </button>
              <button
                onClick={() => {
                  const demo = demoBusiness("shop");
                  setBusiness({ ...demo, sheet: attachSources(demo.sheet, demo.chats), live: true });
                  // A live demo opens on the assistant, like any running business.
                  router.push("/live");
                }}
              >
                {t("home_demo")}
              </button>
            </div>
            <p className="muted small">{t("home_note")}</p>
          </>
        )}
      </div>
    </main>
  );
}
