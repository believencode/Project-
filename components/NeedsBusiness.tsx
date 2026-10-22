"use client";

import Link from "next/link";
import { useStore } from "@/lib/store";
import { useT } from "@/lib/i18n/react";

export function NeedsBusiness() {
  const { ready } = useStore();
  const { t } = useT();
  if (!ready) return null;
  return (
    <main className="page narrow">
      <div className="card">
        <h1>{t("no_business_title")}</h1>
        <p>{t("no_business_body")}</p>
        <Link className="btn primary" href="/">{t("start")}</Link>
      </div>
    </main>
  );
}
