"use client";

import { useState } from "react";
import type { FactSource, Sheet } from "@/lib/types";
import type { Answer, Question } from "@/lib/clarify";
import { parsePriceLines } from "@/lib/clarify";
import { Source } from "./Source";
import { useT } from "@/lib/i18n/react";

/** One question per screen for every fact the AI wasn't sure about. */
export function Clarify({
  sheet,
  questions,
  answers,
  onAnswer,
  onDone,
  onExit,
  fromChats,
}: {
  sheet: Sheet;
  /** The facts came from imported chats (not typed by the owner): wording of "not found" questions. */
  fromChats: boolean;
  questions: Question[];
  answers: Record<string, Answer>;
  onAnswer: (id: string, a: Answer) => void;
  /** All answers, including the last one. */
  onDone: (answers: Record<string, Answer>) => void;
  /** Back from the first question. */
  onExit: () => void;
}) {
  const [i, setI] = useState(0);
  const { t } = useT();
  const q = questions[i];

  const answer = (a: Answer) => {
    onAnswer(q.id, a);
    if (i + 1 < questions.length) setI(i + 1);
    else onDone({ ...answers, [q.id]: a });
  };
  const back = () => (i === 0 ? onExit() : setI(i - 1));

  return (
    <div className="card stack">
      <div className="row between">
        <button className="ghost" onClick={back}>{t("back")}</button>
        <span className="muted small">{t("question_n", { i: i + 1, n: questions.length })}</span>
      </div>
      <div className="progress" style={{ margin: 0 }}>
        <div style={{ width: `${((i + 1) / questions.length) * 100}%` }} />
      </div>
      <QuestionView key={q.id} q={q} sheet={sheet} previous={answers[q.id]} onAnswer={answer} fromChats={fromChats} />
    </div>
  );
}

function QuestionView({
  q,
  sheet,
  previous,
  onAnswer,
  fromChats,
}: {
  q: Question;
  sheet: Sheet;
  previous?: Answer;
  onAnswer: (a: Answer) => void;
  fromChats: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const { t } = useT();
  const [value, setValue] = useState(previous?.action === "set_text" ? previous.text : previous?.action === "set_amount" ? String(previous.amount) : "");

  const editor = (placeholder: string, kind: "text" | "number", save: (v: string) => Answer | null) => (
    <div className="row" style={{ flexWrap: "nowrap" }}>
      <input
        type={kind}
        autoFocus
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          const a = e.key === "Enter" ? save(value) : null;
          if (a) onAnswer(a);
        }}
      />
      <button
        className="primary"
        disabled={!value.trim()}
        onClick={() => {
          const a = save(value);
          if (a) onAnswer(a);
        }}
      >
        {t("save")}
      </button>
    </div>
  );
  const amountAnswer = (v: string): Answer | null => (Number(v) > 0 ? { action: "set_amount", amount: Number(v) } : null);
  const textAnswer = (v: string): Answer | null => (v.trim() ? { action: "set_text", text: v.trim() } : null);

  switch (q.kind) {
    case "price_conflict": {
      const p = sheet.prices.find((x) => x.id === q.priceId)!;
      const options = [{ amount: p.amount, source: p.source }, ...(p.alternatives ?? [])].sort(
        (a, b) => (b.source?.at ?? 0) - (a.source?.at ?? 0),
      );
      return (
        <>
          <h1>{t("conflict_q", { item: p.item })}</h1>
          <p className="muted">{t("conflict_body")}</p>
          {options.map((o, k) => (
            <button key={o.amount} className="option" onClick={() => onAnswer({ action: "set_amount", amount: o.amount })}>
              <span>
                <strong>{o.amount} сом</strong>
                {k === 0 ? <span className="badge ok" style={{ marginLeft: 8 }}>{t("newest")}</span> : null}
                <Source source={o.source as FactSource | undefined} />
              </span>
              <span>→</span>
            </button>
          ))}
          {editing ? editor(t("other_price_ph"), "number", amountAnswer) : (
            <div className="row">
              <button onClick={() => setEditing(true)}>{t("other_price")}</button>
              <button className="ghost" onClick={() => onAnswer({ action: "remove" })}>{t("dont_quote_price")}</button>
            </div>
          )}
        </>
      );
    }
    case "price": {
      const p = sheet.prices.find((x) => x.id === q.priceId)!;
      return (
        <>
          <h1>{t("price_q")}</h1>
          <div className="fact">
            <div className="value">{p.item} — {p.amount} сом</div>
            <Source source={p.source} />
          </div>
          {editing ? editor(t("correct_price_ph"), "number", amountAnswer) : (
            <div className="row">
              <button className="primary" onClick={() => onAnswer({ action: "keep" })}>{t("yes_correct")}</button>
              <button onClick={() => setEditing(true)}>{t("change_price")}</button>
              <button className="ghost" onClick={() => onAnswer({ action: "remove" })}>{t("dont_quote")}</button>
            </div>
          )}
        </>
      );
    }
    case "availability": {
      const n = sheet.availability.find((x) => x.id === q.noteId)!;
      return (
        <>
          <h1>{t("avail_q")}</h1>
          <div className="fact">
            <div className="value">{n.text}</div>
            <Source source={n.source} />
          </div>
          <p className="muted small">{t("avail_body")}</p>
          {editing ? editor(n.text, "text", textAnswer) : (
            <div className="row">
              <button className="primary" onClick={() => onAnswer({ action: "keep" })}>{t("still_true")}</button>
              <button onClick={() => { setValue(n.text); setEditing(true); }}>{t("change")}</button>
              <button className="ghost" onClick={() => onAnswer({ action: "remove" })}>{t("remove")}</button>
            </div>
          )}
        </>
      );
    }
    case "fact": {
      const f = sheet.facts?.find((x) => x.id === q.factId);
      if (!f) return null;
      return (
        <>
          <h1>{t("fact_q")}</h1>
          <div className="fact">
            <div className="muted small">{f.topic}</div>
            <div className="value">{f.text}</div>
            <Source source={f.source} />
          </div>
          <p className="muted small">{t("fact_body", { topic: f.topic })}</p>
          {editing ? editor(f.text, "text", textAnswer) : (
            <div className="row">
              <button className="primary" onClick={() => onAnswer({ action: "keep" })}>{t("yes_correct")}</button>
              <button onClick={() => { setValue(f.text); setEditing(true); }}>{t("change")}</button>
              <button className="ghost" onClick={() => onAnswer({ action: "remove" })}>{t("remove")}</button>
            </div>
          )}
        </>
      );
    }
    case "hours":
    case "address": {
      const isHours = q.kind === "hours";
      const current = isHours ? sheet.hours : sheet.address;
      const source = isHours ? sheet.hours_source : sheet.address_source;
      const placeholder = isHours ? "09:00–21:00" : "Бишкек, ул. Киевская 100";
      if (!current) {
        return (
          <>
            <h1>{t(isHours ? "hours_q_missing" : "address_q_missing")}</h1>
            <p className="muted">
              {fromChats ? t(isHours ? "not_found_hours" : "not_found_address") : t(isHours ? "often_ask_hours" : "often_ask_address")}
            </p>
            {editor(placeholder, "text", textAnswer)}
            <button className="ghost" onClick={() => onAnswer({ action: "skip" })}>{t("skip_person")}</button>
          </>
        );
      }
      return (
        <>
          <h1>{t(isHours ? "hours_q" : "address_q")}</h1>
          <div className="fact">
            <div className="value">{current}</div>
            <Source source={source} />
          </div>
          {editing ? editor(current, "text", textAnswer) : (
            <div className="row">
              <button className="primary" onClick={() => onAnswer({ action: "keep" })}>{t("yes_correct")}</button>
              <button onClick={() => { setValue(current); setEditing(true); }}>{t("change")}</button>
            </div>
          )}
        </>
      );
    }
    case "prices_missing": {
      const lines = parsePriceLines(value);
      return (
        <>
          <h1>{t("prices_q")}</h1>
          <p className="muted">
            {t(fromChats ? "no_prices_found" : "often_ask_prices")} {t("prices_hint")}
          </p>
          <textarea value={value} placeholder={"Лагман 250\nМанты 300"} onChange={(e) => setValue(e.target.value)} />
          {lines.length > 0 ? <p className="small muted">{lines.map((l) => `${l.item} — ${l.amount} сом`).join(" · ")}</p> : null}
          <div className="row">
            <button className="primary" disabled={lines.length === 0} onClick={() => onAnswer({ action: "add_prices", lines })}>{t("save")}</button>
            <button className="ghost" onClick={() => onAnswer({ action: "skip" })}>{t("skip_prices")}</button>
          </div>
        </>
      );
    }
  }
}
