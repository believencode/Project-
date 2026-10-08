"use client";

import { useState } from "react";
import type { Sheet } from "@/lib/types";
import { useStore } from "@/lib/store";
import { decideWithRules } from "@/lib/rules";
import { BUSINESS_TYPES, MISSING_ANSWER_LINE, offTopicLine } from "@/lib/copy";

function sampleQuestions(sheet: Sheet): string[] {
  const qs: string[] = [];
  if (sheet.prices[0]) qs.push(`Какая цена на ${sheet.prices[0].item.toLowerCase()}?`);
  qs.push(sheet.type === "cafe" ? "Есть свободный столик на вечер?" : sheet.type === "shop" ? "Какой размер есть?" : "Есть свободное время завтра?");
  qs.push("До скольки вы работаете?");
  qs.push("Где вы находитесь?");
  qs.push("Напиши сочинение про лето");
  return qs;
}

function sampleReply(q: string, sheet: Sheet): string {
  const d = decideWithRules(q, sheet);
  if (d.label === "off_topic") return offTopicLine(sheet.type);
  return d.missing || !d.reply ? MISSING_ANSWER_LINE : d.reply;
}

let rowSeq = 0;
const rowId = (p: string) => `${p}-${Date.now().toString(36)}-${++rowSeq}`;

export function ReviewSheet({ mode, onDone }: { mode: "wizard" | "edit"; onDone: () => void }) {
  const { business, updateSheet } = useStore();
  const [confirming, setConfirming] = useState(false);
  const [saved, setSaved] = useState(false);
  if (!business) return null;
  const sheet = business.sheet;

  const unchecked = sheet.prices.filter((p) => p.needs_check).length + sheet.availability.filter((n) => n.needs_check).length;

  const confirmAll = () =>
    updateSheet((s) => ({
      ...s,
      prices: s.prices.map((p) => ({ ...p, needs_check: false })),
      availability: s.availability.map((n) => ({ ...n, needs_check: false })),
    }));

  const finish = () => {
    setSaved(true);
    onDone();
  };

  const approve = () => (unchecked > 0 ? setConfirming(true) : finish());
  const typeLabel = BUSINESS_TYPES.find((t) => t.id === sheet.type)?.label ?? sheet.type;

  return (
    <div>
      <div className="row between" style={{ marginBottom: "1rem" }}>
        <div>
          <h1>{mode === "wizard" ? "Check what the bot will say" : "Knowledge sheet"}</h1>
          <p className="muted">
            {sheet.name} · {typeLabel} · {business.imported_history ? "facts from your old chats" : "facts you entered"}
          </p>
        </div>
        {unchecked > 0 ? (
          <button onClick={confirmAll}>Confirm all ({unchecked})</button>
        ) : (
          <span className="badge ok">All facts confirmed</span>
        )}
      </div>

      {unchecked > 0 ? (
        <div className="notice warn">
          Facts marked <span className="badge check">check this</span> came from old chats. The bot will not quote them
          until you confirm or edit them.
        </div>
      ) : null}

      <div className="grid2">
        <div>
          <div className="card stack">
            <h2>Hours and address</h2>
            <label className="field">
              <span>Hours</span>
              <input type="text" value={sheet.hours} placeholder="10:00–20:00" onChange={(e) => updateSheet((s) => ({ ...s, hours: e.target.value }))} />
            </label>
            <label className="field">
              <span>Address</span>
              <input type="text" value={sheet.address} placeholder="Бишкек, ..." onChange={(e) => updateSheet((s) => ({ ...s, address: e.target.value }))} />
            </label>
          </div>

          <div className="card">
            <h2>Prices</h2>
            <table className="facts">
              <thead>
                <tr>
                  <th>Item</th>
                  <th style={{ width: 100 }}>Price, сом</th>
                  <th style={{ width: 200 }} />
                </tr>
              </thead>
              <tbody>
                {sheet.prices.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <input
                        type="text"
                        value={p.item}
                        aria-label="Item"
                        onChange={(e) => updateSheet((s) => ({ ...s, prices: s.prices.map((x) => (x.id === p.id ? { ...x, item: e.target.value, needs_check: false } : x)) }))}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        value={p.amount}
                        aria-label="Price"
                        onChange={(e) => updateSheet((s) => ({ ...s, prices: s.prices.map((x) => (x.id === p.id ? { ...x, amount: Number(e.target.value), needs_check: false } : x)) }))}
                      />
                    </td>
                    <td>
                      <div className="row" style={{ flexWrap: "nowrap" }}>
                        {p.needs_check ? (
                          <>
                            <span className="badge check">check this</span>
                            <button className="small" onClick={() => updateSheet((s) => ({ ...s, prices: s.prices.map((x) => (x.id === p.id ? { ...x, needs_check: false } : x)) }))}>
                              Confirm
                            </button>
                          </>
                        ) : (
                          <span className="badge ok">confirmed</span>
                        )}
                        <button className="ghost small" aria-label="Remove" onClick={() => updateSheet((s) => ({ ...s, prices: s.prices.filter((x) => x.id !== p.id) }))}>
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              className="ghost"
              style={{ marginTop: 8 }}
              onClick={() => updateSheet((s) => ({ ...s, prices: [...s.prices, { id: rowId("p"), item: "", amount: 0, currency: "сом", needs_check: false }] }))}
            >
              + Add price
            </button>
          </div>

          <div className="card">
            <h2>Availability</h2>
            <p className="muted small">The bot always says «по последним данным» and offers a person to check.</p>
            {sheet.availability.map((n) => (
              <div key={n.id} className="row" style={{ marginBottom: 8, flexWrap: "nowrap" }}>
                <input
                  type="text"
                  value={n.text}
                  aria-label="Availability note"
                  onChange={(e) => updateSheet((s) => ({ ...s, availability: s.availability.map((x) => (x.id === n.id ? { ...x, text: e.target.value, needs_check: false } : x)) }))}
                />
                {n.needs_check ? (
                  <>
                    <span className="badge check">check this</span>
                    <button className="small" onClick={() => updateSheet((s) => ({ ...s, availability: s.availability.map((x) => (x.id === n.id ? { ...x, needs_check: false } : x)) }))}>
                      Confirm
                    </button>
                  </>
                ) : (
                  <span className="badge ok">confirmed</span>
                )}
                <button className="ghost small" aria-label="Remove" onClick={() => updateSheet((s) => ({ ...s, availability: s.availability.filter((x) => x.id !== n.id) }))}>
                  ✕
                </button>
              </div>
            ))}
            <button className="ghost" onClick={() => updateSheet((s) => ({ ...s, availability: [...s.availability, { id: rowId("a"), text: "", needs_check: false }] }))}>
              + Add note
            </button>
          </div>
        </div>

        <div>
          <div className="card">
            <h2>Sample replies</h2>
            <p className="muted small">What the bot sends right now, from confirmed facts only.</p>
            <div className="stack">
              {sampleQuestions(sheet).map((q) => (
                <div key={q}>
                  <div className="bubble customer" style={{ maxWidth: "100%" }}>{q}</div>
                  <div className="bubble bot" style={{ maxWidth: "100%", marginTop: 4, marginLeft: "1.5rem" }}>{sampleReply(q, sheet)}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h2>Top questions</h2>
            <div className="row">
              {sheet.top_questions.length ? sheet.top_questions.map((q) => <span key={q} className="badge plain">{q}</span>) : <span className="muted">None yet</span>}
            </div>
            {sheet.tone_examples.length ? (
              <>
                <h3 style={{ marginTop: "1rem" }}>Tone examples</h3>
                {sheet.tone_examples.map((t) => (
                  <p key={t} className="muted">«{t}»</p>
                ))}
              </>
            ) : null}
            <h3 style={{ marginTop: "1rem" }}>Allowed topics</h3>
            <div className="row">
              {sheet.allowed_topics.map((t) => <span key={t} className="badge info">{t}</span>)}
            </div>
          </div>
        </div>
      </div>

      <div className="row" style={{ justifyContent: "flex-end", marginTop: "0.5rem" }}>
        {saved && mode === "edit" ? <span className="badge ok">Saved</span> : null}
        <button className="primary" onClick={approve}>
          {mode === "wizard" ? "Approve and go live" : "Save"}
        </button>
      </div>

      {confirming ? (
        <div className="overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <h2>{unchecked} facts are not confirmed</h2>
            <p>The bot will not quote them and will hand those questions to a person.</p>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="ghost" onClick={() => setConfirming(false)}>Cancel</button>
              <button onClick={() => { setConfirming(false); finish(); }}>{mode === "wizard" ? "Go live anyway" : "Save anyway"}</button>
              <button className="primary" onClick={() => { confirmAll(); setConfirming(false); finish(); }}>
                {mode === "wizard" ? "Confirm all and go live" : "Confirm all and save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
