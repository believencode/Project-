"use client";

import type { FactSource } from "@/lib/types";
import { useT } from "@/lib/i18n/react";

const day = (at: number) => new Date(at).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });

/** "Чат с Айгерим · 06.10 · «4500 сом.»" or "Вы · 22.10". */
export function Source({ source, quote = true }: { source?: FactSource; quote?: boolean }) {
  const { t } = useT();
  if (!source) return null;
  if (source.by === "owner") return <span className="source">{t("src_you", { date: day(source.at) })}</span>;
  return (
    <span className="source">
      {t("src_chat", { name: source.customer ?? "", date: day(source.at) })}
      {quote && source.quote ? <> · «{source.quote}»</> : null}
    </span>
  );
}
