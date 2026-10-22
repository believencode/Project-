import type { FactSource } from "@/lib/types";

const day = (at: number) => new Date(at).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });

/** "Айгерим · 06.10 · «4500 сом.»" or "You · 22.10". */
export function Source({ source, quote = true }: { source?: FactSource; quote?: boolean }) {
  if (!source) return null;
  if (source.by === "owner") return <span className="source">You · {day(source.at)}</span>;
  return (
    <span className="source">
      Chat with {source.customer} · {day(source.at)}
      {quote && source.quote ? <> · «{source.quote}»</> : null}
    </span>
  );
}
