"use client";

import { useState } from "react";
import type { InfoFact, Sheet } from "@/lib/types";
import { useStore } from "@/lib/store";
import { decideWithRules } from "@/lib/rules";
import { MISSING_ANSWER_LINE, offTopicLine } from "@/lib/copy";
import { useT } from "@/lib/i18n/react";

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
  const { t } = useT();
  if (!business) return null;
  const sheet = business.sheet;

  const facts = sheet.facts ?? [];
  const unchecked =
    sheet.prices.filter((p) => p.needs_check).length + sheet.availability.filter((n) => n.needs_check).length + facts.filter((f) => f.needs_check).length;

  const confirmAll = () =>
    updateSheet((s) => ({
      ...s,
      prices: s.prices.map((p) => ({ ...p, needs_check: false })),
      availability: s.availability.map((n) => ({ ...n, needs_check: false })),
      facts: s.facts?.map((f) => ({ ...f, needs_check: false })),
    }));
  const setFact = (id: string, patch: Partial<InfoFact>) =>
    updateSheet((s) => ({ ...s, facts: (s.facts ?? []).map((x) => (x.id === id ? { ...x, ...patch } : x)) }));

  const finish = () => {
    setSaved(true);
    onDone();
  };

  const approve = () => (unchecked > 0 ? setConfirming(true) : finish());
  const typeLabel = t(`type_${sheet.type}`);

  return (
    <div>
      <div className="row between" style={{ marginBottom: "1rem" }}>
        <div>
          <h1>{t(mode === "wizard" ? "review_title_wizard" : "review_title_edit")}</h1>
          <p className="muted">
            {sheet.name} · {typeLabel} · {business.sheet_built_by === "ai"
              ? t("review_sub_ai", { n: business.chats.filter((c) => !c.is_test).length })
              : t(business.imported_history ? "review_sub_demo" : "review_sub_owner")}
          </p>
        </div>
        {unchecked > 0 ? (
          <button onClick={confirmAll}>{t("confirm_all", { n: unchecked })}</button>
        ) : (
          <span className="badge ok">{t("all_confirmed")}</span>
        )}
      </div>

      {unchecked > 0 ? (
        <div className="notice warn">
          {t("unchecked_notice").split("{badge}")[0]}
          <span className="badge check">{t("check_this")}</span>
          {t("unchecked_notice").split("{badge}")[1]}
        </div>
      ) : null}

      <div className="grid2">
        <div>
          <div className="card stack">
            <h2>{t("hours_address")}</h2>
            <label className="field">
              <span>{t("hours")}</span>
              <input type="text" value={sheet.hours} placeholder="10:00–20:00" onChange={(e) => updateSheet((s) => ({ ...s, hours: e.target.value }))} />
            </label>
            <label className="field">
              <span>{t("address")}</span>
              <input type="text" value={sheet.address} placeholder="Бишкек, ..." onChange={(e) => updateSheet((s) => ({ ...s, address: e.target.value }))} />
            </label>
          </div>

          <div className="card">
            <h2>{t("prices")}</h2>
            <table className="facts">
              <thead>
                <tr>
                  <th>{t("item")}</th>
                  <th style={{ width: 100 }}>{t("price_som")}</th>
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
                        aria-label={t("item")}
                        onChange={(e) => updateSheet((s) => ({ ...s, prices: s.prices.map((x) => (x.id === p.id ? { ...x, item: e.target.value, needs_check: false } : x)) }))}
                      />
                      <input
                        type="text"
                        className="small"
                        style={{ marginTop: 4 }}
                        value={p.details ?? ""}
                        placeholder={t("details_ph")}
                        aria-label={t("details_ph")}
                        onChange={(e) => updateSheet((s) => ({ ...s, prices: s.prices.map((x) => (x.id === p.id ? { ...x, details: e.target.value } : x)) }))}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        value={p.amount}
                        aria-label={t("price_som")}
                        onChange={(e) => updateSheet((s) => ({ ...s, prices: s.prices.map((x) => (x.id === p.id ? { ...x, amount: Number(e.target.value), needs_check: false } : x)) }))}
                      />
                    </td>
                    <td>
                      <div className="row" style={{ flexWrap: "nowrap" }}>
                        {p.needs_check ? (
                          <>
                            <span className="badge check">{t("check_this")}</span>
                            <button className="small" onClick={() => updateSheet((s) => ({ ...s, prices: s.prices.map((x) => (x.id === p.id ? { ...x, needs_check: false } : x)) }))}>
                              {t("confirm")}
                            </button>
                          </>
                        ) : (
                          <span className="badge ok">{t("confirmed")}</span>
                        )}
                        <button className="ghost small" aria-label={t("remove")} onClick={() => updateSheet((s) => ({ ...s, prices: s.prices.filter((x) => x.id !== p.id) }))}>
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
              {t("add_price")}
            </button>
          </div>

          <div className="card">
            <h2>{t("availability")}</h2>
            <p className="muted small">{t("avail_hint")}</p>
            {sheet.availability.map((n) => (
              <div key={n.id} className="row" style={{ marginBottom: 8, flexWrap: "nowrap" }}>
                <input
                  type="text"
                  value={n.text}
                  aria-label={t("availability")}
                  onChange={(e) => updateSheet((s) => ({ ...s, availability: s.availability.map((x) => (x.id === n.id ? { ...x, text: e.target.value, needs_check: false } : x)) }))}
                />
                {n.needs_check ? (
                  <>
                    <span className="badge check">{t("check_this")}</span>
                    <button className="small" onClick={() => updateSheet((s) => ({ ...s, availability: s.availability.map((x) => (x.id === n.id ? { ...x, needs_check: false } : x)) }))}>
                      {t("confirm")}
                    </button>
                  </>
                ) : (
                  <span className="badge ok">{t("confirmed")}</span>
                )}
                <button className="ghost small" aria-label={t("remove")} onClick={() => updateSheet((s) => ({ ...s, availability: s.availability.filter((x) => x.id !== n.id) }))}>
                  ✕
                </button>
              </div>
            ))}
            <button className="ghost" onClick={() => updateSheet((s) => ({ ...s, availability: [...s.availability, { id: rowId("a"), text: "", needs_check: false }] }))}>
              {t("add_note")}
            </button>
          </div>

          <div className="card">
            <h2>{t("other_facts")}</h2>
            <p className="muted small">{t("facts_hint")}</p>
            {facts.map((f) => (
              <div key={f.id} className="stack" style={{ marginBottom: 12, gap: 4 }}>
                <div className="row" style={{ flexWrap: "nowrap" }}>
                  <input type="text" value={f.topic} placeholder="Доставка" aria-label={t("topic")} style={{ maxWidth: 160 }} onChange={(e) => setFact(f.id, { topic: e.target.value, needs_check: false })} />
                  {f.needs_check ? (
                    <>
                      <span className="badge check">{t("check_this")}</span>
                      <button className="small" onClick={() => setFact(f.id, { needs_check: false })}>{t("confirm")}</button>
                    </>
                  ) : (
                    <span className="badge ok">{t("confirmed")}</span>
                  )}
                  <button className="ghost small" aria-label={t("remove")} onClick={() => updateSheet((s) => ({ ...s, facts: (s.facts ?? []).filter((x) => x.id !== f.id) }))}>
                    ✕
                  </button>
                </div>
                <input type="text" value={f.text} placeholder="Доставка по Бишкеку — 200 сом." aria-label={t("fact")} onChange={(e) => setFact(f.id, { text: e.target.value, needs_check: false })} />
              </div>
            ))}
            <button className="ghost" onClick={() => updateSheet((s) => ({ ...s, facts: [...(s.facts ?? []), { id: rowId("f"), topic: "", text: "", needs_check: false }] }))}>
              {t("add_fact")}
            </button>
          </div>
        </div>

        <div>
          <div className="card">
            <h2>{t("sample_replies")}</h2>
            <p className="muted small">{t("sample_hint")}</p>
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
            <h2>{t("top_questions")}</h2>
            <div className="row">
              {sheet.top_questions.length ? sheet.top_questions.map((q) => <span key={q} className="badge plain">{q}</span>) : <span className="muted">{t("none_yet")}</span>}
            </div>
            {sheet.tone_examples.length ? (
              <>
                <h3 style={{ marginTop: "1rem" }}>{t("tone_examples")}</h3>
                {sheet.tone_examples.map((t) => (
                  <p key={t} className="muted">«{t}»</p>
                ))}
              </>
            ) : null}
            <h3 style={{ marginTop: "1rem" }}>{t("allowed_topics")}</h3>
            <div className="row">
              {sheet.allowed_topics.map((topic) => <span key={topic} className="badge info">{t(`topic_${topic}`)}</span>)}
            </div>
          </div>
        </div>
      </div>

      <div className="row" style={{ justifyContent: "flex-end", marginTop: "0.5rem" }}>
        {saved && mode === "edit" ? <span className="badge ok">{t("saved")}</span> : null}
        <button className="primary" onClick={approve}>
          {t(mode === "wizard" ? "approve_go_live" : "save")}
        </button>
      </div>

      {confirming ? (
        <div className="overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <h2>{t("unconfirmed_title", { n: unchecked })}</h2>
            <p>{t("unconfirmed_body")}</p>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="ghost" onClick={() => setConfirming(false)}>{t("cancel")}</button>
              <button onClick={() => { setConfirming(false); finish(); }}>{t(mode === "wizard" ? "go_live_anyway" : "save_anyway")}</button>
              <button className="primary" onClick={() => { confirmAll(); setConfirming(false); finish(); }}>
                {t(mode === "wizard" ? "confirm_all_go" : "confirm_all_save")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
