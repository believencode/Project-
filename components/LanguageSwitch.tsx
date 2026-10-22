"use client";

import { LANGS } from "@/lib/i18n";
import { useT } from "@/lib/i18n/react";

/** Рус / Кыр / Eng. Compact for the top bar; `full` shows the language names as buttons. */
export function LanguageSwitch({ full = false }: { full?: boolean }) {
  const { lang, setLang, t } = useT();
  if (full) {
    return (
      <div className="choices">
        {LANGS.map((l) => (
          <button key={l.id} className={`choice ${lang === l.id ? "on" : ""}`} onClick={() => setLang(l.id)}>
            {l.label}
          </button>
        ))}
      </div>
    );
  }
  return (
    <select className="lang-select" aria-label={t("app_language")} value={lang} onChange={(e) => setLang(e.target.value as typeof lang)}>
      {LANGS.map((l) => (
        <option key={l.id} value={l.id}>{l.short}</option>
      ))}
    </select>
  );
}
