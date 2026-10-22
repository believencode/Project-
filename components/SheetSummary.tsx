"use client";

import { useState } from "react";
import type { EditOp } from "@/lib/edits";
import { applyOps, describeOp } from "@/lib/edits";
import { useStore } from "@/lib/store";
import { Source } from "./Source";
import { FactSuggestions } from "./FactSuggestions";
import { useT } from "@/lib/i18n/react";
import type { Key, Vars } from "@/lib/i18n";
import type { Sheet } from "@/lib/types";

const LANGUAGE: Record<string, Key> = { ru: "lang_ru", ky: "lang_ky", both: "lang_both_long" };

interface Proposal {
  request: string;
  ops: EditOp[];
  dropped: string[];
  unclear: string;
}

function found(sheet: Sheet, t: (key: Key, vars?: Vars) => string): string {
  const parts = [
    sheet.prices.length ? t("n_prices", { n: sheet.prices.length }) : "",
    sheet.hours ? t("your_hours") : "",
    sheet.address ? t("your_address") : "",
    sheet.availability.length ? t("n_stock", { n: sheet.availability.length }) : "",
    sheet.facts?.length ? t("n_facts", { n: sheet.facts.length }) : "",
  ].filter(Boolean);
  if (parts.length === 0) return t("nothing_yet");
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")}${t("and")}${parts.at(-1)}`;
}

/** Plain-language summary of what the bot knows, with changes requested in the owner's own words. */
export function SheetSummary({ mode, onApprove, onEditDetails }: { mode: "wizard" | "edit"; onApprove?: () => void; onEditDetails: () => void }) {
  const { business, updateSheet } = useStore();
  const { t, tError, lang } = useT();
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [applied, setApplied] = useState<string[] | null>(null);
  if (!business) return null;
  const sheet = business.sheet;
  const chatsRead = business.chats.filter((c) => !c.is_test).length;

  const notSet = [
    !sheet.hours && t("ns_hours"),
    !sheet.address && t("ns_address"),
    sheet.prices.length === 0 && t("ns_prices"),
  ].filter(Boolean) as string[];
  const unchecked =
    sheet.prices.filter((p) => p.needs_check).length +
    sheet.availability.filter((n) => n.needs_check).length +
    (sheet.facts ?? []).filter((f) => f.needs_check).length;

  const ask = async () => {
    if (!request.trim()) return;
    setBusy(true);
    setError(null);
    setApplied(null);
    try {
      const res = await fetch("/api/edit-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheet, request, lang }),
      });
      const body = (await res.json()) as { ops?: EditOp[]; dropped?: string[]; unclear?: string; error?: string };
      if (!res.ok || !body.ops) throw new Error(body.error ? tError(body.error) : t("generic_error"));
      setProposal({ request, ops: body.ops, dropped: body.dropped ?? [], unclear: body.unclear ?? "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("generic_error"));
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!proposal) return;
    setApplied(proposal.ops.map((op) => describeOp(op, sheet, lang)));
    updateSheet((s) => applyOps(s, proposal.ops, Date.now()));
    setProposal(null);
    setRequest("");
  };

  const intro =
    business.sheet_built_by === "ai"
      ? t("intro_ai", { n: chatsRead })
      : business.imported_history
        ? t("intro_demo", { n: chatsRead })
        : t("intro_owner");

  return (
    <div>
      <h1>{t(mode === "wizard" ? "summary_title_wizard" : "summary_title_edit")}</h1>
      <p className="muted">{intro}</p>
      <p>
        <strong>{t("found_label")}</strong> {found(sheet, t)}.
      </p>

      {mode === "edit" ? <FactSuggestions /> : null}

      <div className="grid2">
        <div>
          <div className="card">
            <ul className="summary-list">
              <li>
                <strong>{t("hours")}:</strong> {sheet.hours || <span className="muted">{t("not_set")}</span>}
                <Source source={sheet.hours_source} quote={false} />
              </li>
              <li>
                <strong>{t("address")}:</strong> {sheet.address || <span className="muted">{t("not_set")}</span>}
                <Source source={sheet.address_source} quote={false} />
              </li>
              <li>
                <strong>{t("prices")}</strong>
                {sheet.prices.length === 0 ? <div className="muted">{t("none")}</div> : null}
                {sheet.prices.map((p) => (
                  <div key={p.id} style={{ marginTop: 6 }}>
                    {p.item} — {p.amount} {p.currency}
                    {p.needs_check ? <span className="badge check" style={{ marginLeft: 6 }}>{t("not_confirmed")}</span> : null}
                    {p.details ? <div className="muted small">{p.details}</div> : null}
                    <Source source={p.source} />
                  </div>
                ))}
              </li>
              <li>
                <strong>{t("stock_title")}</strong>
                {sheet.availability.length === 0 ? <div className="muted">{t("none")}</div> : null}
                {sheet.availability.map((n) => (
                  <div key={n.id} style={{ marginTop: 6 }}>
                    {n.text}
                    {n.needs_check ? <span className="badge check" style={{ marginLeft: 6 }}>{t("not_confirmed")}</span> : null}
                    <Source source={n.source} />
                  </div>
                ))}
              </li>
              <li>
                <strong>{t("other_facts")}</strong>
                <div className="muted small">{t("other_facts_hint")}</div>
                {(sheet.facts ?? []).length === 0 ? <div className="muted">{t("none_yet")}</div> : null}
                {(sheet.facts ?? []).map((f) => (
                  <div key={f.id} style={{ marginTop: 6 }}>
                    <strong className="small">{f.topic}:</strong> {f.text}
                    {f.needs_check ? <span className="badge check" style={{ marginLeft: 6 }}>{t("not_confirmed")}</span> : null}
                    <Source source={f.source} />
                  </div>
                ))}
              </li>
            </ul>
          </div>
        </div>

        <div>
          <div className="card stack">
            {sheet.top_questions.length ? (
              <div>
                <strong>{t("mostly_ask")}</strong> {sheet.top_questions.join(", ").toLowerCase()}
              </div>
            ) : null}
            {sheet.tone_examples.length ? (
              <div>
                <strong>{t("sound_like")}</strong>
                {sheet.tone_examples.map((t) => (
                  <div key={t} className="muted">«{t}»</div>
                ))}
              </div>
            ) : null}
            <div>
              <strong>{t("replies_in")}</strong> {t(LANGUAGE[sheet.language ?? "both"])}
            </div>
            {notSet.length ? (
              <div className="notice warn small" style={{ margin: 0 }}>
                {t("not_set_list", { list: notSet.join(", ") })}
              </div>
            ) : null}
            {unchecked ? (
              <div className="notice warn small" style={{ margin: 0 }}>
                {t("unchecked_n", { n: unchecked })}
              </div>
            ) : null}
          </div>

          <div className="card stack">
            <h2>{t("wrong_title")}</h2>
            <p className="muted small">{t("wrong_hint")}</p>
            <textarea
              value={request}
              placeholder={t("wrong_ph")}
              onChange={(e) => setRequest(e.target.value)}
            />
            <div className="row">
              <button className="primary" onClick={ask} disabled={busy || !request.trim()}>
                {busy ? t("reading") : t("suggest_changes")}
              </button>
              <button className="ghost" onClick={onEditDetails}>{t("edit_by_hand")}</button>
            </div>
            {error ? <div className="notice warn small" style={{ margin: 0 }}>{error}</div> : null}

            {proposal ? (
              <div className="stack">
                <strong>{t("changes_to_apply")}</strong>
                {proposal.ops.length === 0 ? <div className="muted">{t("no_changes")}</div> : null}
                {proposal.ops.map((op, k) => (
                  <div key={k} className="change">{describeOp(op, sheet, lang)}</div>
                ))}
                {proposal.dropped.length ? (
                  <div className="small muted">{t("not_applied", { list: proposal.dropped.join(", ") })}</div>
                ) : null}
                {proposal.unclear ? <div className="notice small" style={{ margin: 0 }}>{proposal.unclear}</div> : null}
                <div className="row">
                  <button className="ghost" onClick={() => setProposal(null)}>{t("cancel")}</button>
                  <button className="primary" disabled={proposal.ops.length === 0} onClick={apply}>{t("apply_changes")}</button>
                </div>
              </div>
            ) : null}
            {applied ? (
              <div className="small">
                <span className="badge ok">{t("applied")}</span> {applied.join(" · ")}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {mode === "wizard" && onApprove ? (
        <div className="row" style={{ justifyContent: "flex-end", marginTop: "0.5rem" }}>
          <button className="primary" onClick={onApprove}>{t("approve_go_live")}</button>
        </div>
      ) : null}
    </div>
  );
}
