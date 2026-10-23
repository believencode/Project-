"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { demoBusiness, useStore } from "@/lib/store";
import { attachSources } from "@/lib/sources";
import { useT } from "@/lib/i18n/react";

export default function Home() {
  const { ready, business, setBusiness } = useStore();
  const router = useRouter();
  const { t } = useT();
  if (!ready) return null;

  return (
    <main className="page narrow">
      <div className="card stack">
        <h1>Jardamchy</h1>
        <p>{t("home_intro")}</p>
        {business ? (
          <div className="notice">
            <strong>{business.sheet.name}</strong> {t(business.live ? "home_is_live" : "home_not_live")}{" "}
            <Link href={business.live ? "/live" : "/setup"}>{t(business.live ? "home_open" : "home_continue")}</Link>
          </div>
        ) : null}
        <div className="row">
          <button
            className="primary"
            onClick={() => {
              setBusiness(null);
              router.push("/setup");
            }}
          >
            {t("home_setup")}
          </button>
          <button
            onClick={() => {
              const demo = demoBusiness("shop");
              setBusiness({ ...demo, sheet: attachSources(demo.sheet, demo.chats), live: true });
              router.push("/review");
            }}
          >
            {t("home_demo")}
          </button>
        </div>
        <p className="muted small">{t("home_note")}</p>
      </div>
    </main>
  );
}
