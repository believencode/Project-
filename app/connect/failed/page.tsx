"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useT } from "@/lib/i18n/react";
import type { Key } from "@/lib/i18n";
import { failureReason } from "@/lib/whatsapp/failure";

const HELP: [Key, Key][] = [
  ["help_other_t", "help_other_d"],
  ["help_activity_t", "help_activity_d"],
  ["help_account_t", "help_account_d"],
];

function Failed() {
  const params = useSearchParams();
  const { t } = useT();
  return (
    <main className="page narrow">
      <div className="card stack">
        <h1 style={{ margin: 0 }}>{t("failed_title")}</h1>
        <p className="muted" style={{ margin: 0 }}>{t("failed_unchanged")}</p>
        <div className="notice warn small" style={{ margin: 0 }}>
          <strong>{t("failed_reason")}:</strong> {t(failureReason(params.get("error_code")))}
        </div>
      </div>
      <div className="card stack">
        <h2>{t("failed_help")}</h2>
        {HELP.map(([title, body]) => (
          <div key={title}>
            <strong>{t(title)}</strong>
            <div className="small muted">{t(body)}</div>
          </div>
        ))}
      </div>
      <Link href="/connect" className="btn primary block">{t("try_again")}</Link>
      <Link href="/live" className="btn block" style={{ marginTop: 8 }}>{t("back")}</Link>
    </main>
  );
}

export default function FailedPage() {
  return (
    <Suspense>
      <Failed />
    </Suspense>
  );
}
