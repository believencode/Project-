"use client";

import { useState } from "react";
import type { FactSource, Sheet } from "@/lib/types";
import type { Answer, Question } from "@/lib/clarify";
import { parsePriceLines } from "@/lib/clarify";
import { Source } from "./Source";

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
        <button className="ghost" onClick={back}>← Back</button>
        <span className="muted small">
          Question {i + 1} of {questions.length}
        </span>
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
        Save
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
          <h1>Which price is current for «{p.item}»?</h1>
          <p className="muted">Staff quoted different prices in your chats. The bot will only use the one you pick.</p>
          {options.map((o, k) => (
            <button key={o.amount} className="option" onClick={() => onAnswer({ action: "set_amount", amount: o.amount })}>
              <span>
                <strong>{o.amount} сом</strong>
                {k === 0 ? <span className="badge ok" style={{ marginLeft: 8 }}>newest</span> : null}
                <Source source={o.source as FactSource | undefined} />
              </span>
              <span>→</span>
            </button>
          ))}
          {editing ? editor("Another price, сом", "number", amountAnswer) : (
            <div className="row">
              <button onClick={() => setEditing(true)}>Another price</button>
              <button className="ghost" onClick={() => onAnswer({ action: "remove" })}>Don&apos;t quote a price</button>
            </div>
          )}
        </>
      );
    }
    case "price": {
      const p = sheet.prices.find((x) => x.id === q.priceId)!;
      return (
        <>
          <h1>Is this price right?</h1>
          <div className="fact">
            <div className="value">{p.item} — {p.amount} сом</div>
            <Source source={p.source} />
          </div>
          {editing ? editor("Correct price, сом", "number", amountAnswer) : (
            <div className="row">
              <button className="primary" onClick={() => onAnswer({ action: "keep" })}>Yes, correct</button>
              <button onClick={() => setEditing(true)}>Change price</button>
              <button className="ghost" onClick={() => onAnswer({ action: "remove" })}>Don&apos;t quote it</button>
            </div>
          )}
        </>
      );
    }
    case "availability": {
      const n = sheet.availability.find((x) => x.id === q.noteId)!;
      return (
        <>
          <h1>Is this still true?</h1>
          <div className="fact">
            <div className="value">{n.text}</div>
            <Source source={n.source} />
          </div>
          <p className="muted small">Stock changes often. The bot will always say «по последним данным» and offer a person to check.</p>
          {editing ? editor(n.text, "text", textAnswer) : (
            <div className="row">
              <button className="primary" onClick={() => onAnswer({ action: "keep" })}>Yes, still true</button>
              <button onClick={() => { setValue(n.text); setEditing(true); }}>Change</button>
              <button className="ghost" onClick={() => onAnswer({ action: "remove" })}>Remove</button>
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
            <h1>{isHours ? "What are your opening hours?" : "What is your address?"}</h1>
            <p className="muted">
              {fromChats
                ? `We didn't find ${isHours ? "your hours" : "your address"} in the chats.`
                : `Customers often ask for ${isHours ? "opening hours" : "the address"}.`}
            </p>
            {editor(placeholder, "text", textAnswer)}
            <button className="ghost" onClick={() => onAnswer({ action: "skip" })}>Skip — a person will answer these questions</button>
          </>
        );
      }
      return (
        <>
          <h1>{isHours ? "Are these your opening hours?" : "Is this your address?"}</h1>
          <div className="fact">
            <div className="value">{current}</div>
            <Source source={source} />
          </div>
          {editing ? editor(current, "text", textAnswer) : (
            <div className="row">
              <button className="primary" onClick={() => onAnswer({ action: "keep" })}>Yes, correct</button>
              <button onClick={() => { setValue(current); setEditing(true); }}>Change</button>
            </div>
          )}
        </>
      );
    }
    case "prices_missing": {
      const lines = parsePriceLines(value);
      return (
        <>
          <h1>What are your main prices?</h1>
          <p className="muted">
            {fromChats ? "We didn't find any prices in the chats." : "Customers often ask about prices."} One per line, item and price in сом.
          </p>
          <textarea value={value} placeholder={"Лагман 250\nМанты 300"} onChange={(e) => setValue(e.target.value)} />
          {lines.length > 0 ? <p className="small muted">{lines.map((l) => `${l.item} — ${l.amount} сом`).join(" · ")}</p> : null}
          <div className="row">
            <button className="primary" disabled={lines.length === 0} onClick={() => onAnswer({ action: "add_prices", lines })}>Save</button>
            <button className="ghost" onClick={() => onAnswer({ action: "skip" })}>Skip — a person will answer price questions</button>
          </div>
        </>
      );
    }
  }
}
