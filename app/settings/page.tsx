"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { NeedsBusiness } from "@/components/NeedsBusiness";
import { WhatsAppSettings } from "@/components/WhatsAppSettings";
import { AlertSettings } from "@/components/AlertSettings";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { useT } from "@/lib/i18n/react";

export default function SettingsPage() {
  const { business, deleteImportedChats, setBusiness } = useStore();
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const { t } = useT();
  if (!business) return <NeedsBusiness />;
  const imported = business.chats.filter((c) => !c.is_test).length;

  return (
    <main className="page narrow">
      <h1>{t("settings_title")}</h1>

      <div className="card stack">
        <h2>{t("app_language")}</h2>
        <LanguageSwitch full />
      </div>

      <WhatsAppSettings />

      <AlertSettings />

      <div className="card stack">
        <h2>{t("kb_title")}</h2>
        <p className="muted">{t("kb_hint")}</p>
        <Link href="/review" className="btn">{t("kb_edit")}</Link>
      </div>

      <div className="card stack">
        <h2>{t("imported_title")}</h2>
        <p className="muted">
          {business.imported_history ? t("imported_n", { n: imported }) : t("imported_none")} {t("imported_keep")}
        </p>
        {confirm ? (
          <div className="notice warn">
            <p>{t("delete_confirm_q")}</p>
            <div className="row">
              <button className="ghost" onClick={() => setConfirm(false)}>{t("cancel")}</button>
              <button className="danger" onClick={() => { deleteImportedChats(); setConfirm(false); }}>{t("delete_chats")}</button>
            </div>
          </div>
        ) : (
          <button className="danger" disabled={!business.imported_history} onClick={() => setConfirm(true)}>{t("delete_imported")}</button>
        )}
      </div>

      <div className="card stack">
        <h2>{t("prototype")}</h2>
        <button className="ghost" onClick={async () => { await setBusiness(null); router.push("/"); }}>{t("reset_proto")}</button>
      </div>
    </main>
  );
}
