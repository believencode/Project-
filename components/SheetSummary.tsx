"use client";

import { useState } from "react";
import type { EditOp } from "@/lib/edits";
import { applyOps, describeOp } from "@/lib/edits";
import { useStore } from "@/lib/store";
import { Source } from "./Source";
import { FactSuggestions } from "./FactSuggestions";

const LANGUAGE: Record<string, string> = {
  ru: "Russian",
  ky: "Kyrgyz",
  both: "the customer's language — Kyrgyz if they write in Kyrgyz, otherwise Russian",
};

interface Proposal {
  request: string;
  ops: EditOp[];
  dropped: string[];
  unclear: string;
}

function found(sheet: { hours: string; address: string; prices: unknown[]; availability: unknown[]; facts?: unknown[] }): string {
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  const parts = [
    sheet.prices.length ? n(sheet.prices.length, "price", "prices") : "",
    sheet.hours ? "your hours" : "",
    sheet.address ? "your address" : "",
    sheet.availability.length ? n(sheet.availability.length, "stock note", "stock notes") : "",
    sheet.facts?.length ? n(sheet.facts.length, "other fact", "other facts") : "",
  ].filter(Boolean);
  if (parts.length === 0) return "nothing yet";
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/** Plain-language summary of what the bot knows, with changes requested in the owner's own words. */
export function SheetSummary({ mode, onApprove, onEditDetails }: { mode: "wizard" | "edit"; onApprove?: () => void; onEditDetails: () => void }) {
  const { business, updateSheet } = useStore();
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [applied, setApplied] = useState<string[] | null>(null);
  if (!business) return null;
  const sheet = business.sheet;
  const chatsRead = business.chats.filter((c) => !c.is_test).length;

  const notSet = [
    !sheet.hours && "opening hours",
    !sheet.address && "address",
    sheet.prices.length === 0 && "prices",
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
        body: JSON.stringify({ sheet, request }),
      });
      const body = (await res.json()) as { ops?: EditOp[]; dropped?: string[]; unclear?: string; error?: string };
      if (!res.ok || !body.ops) throw new Error(body.error ?? "Something went wrong. Try again.");
      setProposal({ request, ops: body.ops, dropped: body.dropped ?? [], unclear: body.unclear ?? "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!proposal) return;
    setApplied(proposal.ops.map((op) => describeOp(op, sheet)));
    updateSheet((s) => applyOps(s, proposal.ops, Date.now()));
    setProposal(null);
    setRequest("");
  };

  const intro =
    business.sheet_built_by === "ai"
      ? `The AI read ${chatsRead} one-to-one chats from the last 6 months (group chats skipped). Here's what your bot will know, with where each fact came from.`
      : business.imported_history
        ? `Demo facts from ${chatsRead} sample chats. Here's what your bot will know.`
        : "From the facts you entered. Here's what your bot will know.";

  return (
    <div>
      <h1>{mode === "wizard" ? "Here's what your bot knows" : "What your bot knows"}</h1>
      <p className="muted">{intro}</p>
      <p>
        <strong>Found:</strong> {found(sheet)}.
      </p>

      {mode === "edit" ? <FactSuggestions /> : null}

      <div className="grid2">
        <div>
          <div className="card">
            <ul className="summary-list">
              <li>
                <strong>Hours:</strong> {sheet.hours || <span className="muted">not set</span>}
                <Source source={sheet.hours_source} quote={false} />
              </li>
              <li>
                <strong>Address:</strong> {sheet.address || <span className="muted">not set</span>}
                <Source source={sheet.address_source} quote={false} />
              </li>
              <li>
                <strong>Prices</strong>
                {sheet.prices.length === 0 ? <div className="muted">none</div> : null}
                {sheet.prices.map((p) => (
                  <div key={p.id} style={{ marginTop: 6 }}>
                    {p.item} — {p.amount} {p.currency}
                    {p.needs_check ? <span className="badge check" style={{ marginLeft: 6 }}>not confirmed</span> : null}
                    {p.details ? <div className="muted small">{p.details}</div> : null}
                    <Source source={p.source} />
                  </div>
                ))}
              </li>
              <li>
                <strong>Stock and availability</strong>
                {sheet.availability.length === 0 ? <div className="muted">none</div> : null}
                {sheet.availability.map((n) => (
                  <div key={n.id} style={{ marginTop: 6 }}>
                    {n.text}
                    {n.needs_check ? <span className="badge check" style={{ marginLeft: 6 }}>not confirmed</span> : null}
                    <Source source={n.source} />
                  </div>
                ))}
              </li>
              <li>
                <strong>Other facts</strong>
                <div className="muted small">Delivery, payment, returns and anything else customers ask.</div>
                {(sheet.facts ?? []).length === 0 ? <div className="muted">none yet</div> : null}
                {(sheet.facts ?? []).map((f) => (
                  <div key={f.id} style={{ marginTop: 6 }}>
                    <strong className="small">{f.topic}:</strong> {f.text}
                    {f.needs_check ? <span className="badge check" style={{ marginLeft: 6 }}>not confirmed</span> : null}
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
                <strong>Customers mostly ask about:</strong> {sheet.top_questions.join(", ").toLowerCase()}
              </div>
            ) : null}
            {sheet.tone_examples.length ? (
              <div>
                <strong>The bot will sound like your staff:</strong>
                {sheet.tone_examples.map((t) => (
                  <div key={t} className="muted">«{t}»</div>
                ))}
              </div>
            ) : null}
            <div>
              <strong>Replies in:</strong> {LANGUAGE[sheet.language ?? "both"]}
            </div>
            {notSet.length ? (
              <div className="notice warn small" style={{ margin: 0 }}>
                Not set: {notSet.join(", ")}. The bot will pass these questions to a person.
              </div>
            ) : null}
            {unchecked ? (
              <div className="notice warn small" style={{ margin: 0 }}>
                {unchecked} {unchecked === 1 ? "fact isn't" : "facts aren't"} confirmed. The bot won&apos;t quote them.
              </div>
            ) : null}
          </div>

          <div className="card stack">
            <h2>Something wrong or missing?</h2>
            <p className="muted small">Write what to change, in your own words. You&apos;ll see the changes before they&apos;re applied.</p>
            <textarea
              value={request}
              placeholder="Например: лагман теперь 280 сом, работаем до 23:00, доставка по Бишкеку 200 сом, принимаем Мбанк"
              onChange={(e) => setRequest(e.target.value)}
            />
            <div className="row">
              <button className="primary" onClick={ask} disabled={busy || !request.trim()}>
                {busy ? "Reading…" : "Suggest changes"}
              </button>
              <button className="ghost" onClick={onEditDetails}>Edit details by hand</button>
            </div>
            {error ? <div className="notice warn small" style={{ margin: 0 }}>{error}</div> : null}

            {proposal ? (
              <div className="stack">
                <strong>Changes to apply:</strong>
                {proposal.ops.length === 0 ? <div className="muted">No changes found in your request.</div> : null}
                {proposal.ops.map((op, k) => (
                  <div key={k} className="change">{describeOp(op, sheet)}</div>
                ))}
                {proposal.dropped.length ? (
                  <div className="small muted">Not applied, please write the exact value: {proposal.dropped.join(", ")}</div>
                ) : null}
                {proposal.unclear ? <div className="notice small" style={{ margin: 0 }}>{proposal.unclear}</div> : null}
                <div className="row">
                  <button className="ghost" onClick={() => setProposal(null)}>Cancel</button>
                  <button className="primary" disabled={proposal.ops.length === 0} onClick={apply}>Apply changes</button>
                </div>
              </div>
            ) : null}
            {applied ? (
              <div className="small">
                <span className="badge ok">Applied</span> {applied.join(" · ")}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {mode === "wizard" && onApprove ? (
        <div className="row" style={{ justifyContent: "flex-end", marginTop: "0.5rem" }}>
          <button className="primary" onClick={onApprove}>Approve and go live</button>
        </div>
      ) : null}
    </div>
  );
}
