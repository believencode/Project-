"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { BackupAnswers, Business, BusinessType, Sheet, Topic } from "@/lib/types";
import { useStore } from "@/lib/store";
import { testChat } from "@/lib/fixtures";
import { ALLOWED_TOPICS, AVAILABILITY_EXAMPLE, BUSINESS_TYPES, EMPTY_STATE_EXAMPLE } from "@/lib/copy";
import { useT } from "@/lib/i18n/react";
import type { Key } from "@/lib/i18n";
import { ReviewSheet } from "@/components/ReviewSheet";
import { Clarify } from "@/components/Clarify";
import { SheetSummary } from "@/components/SheetSummary";
import { applyAnswers, buildQuestions, type Answer, type Question } from "@/lib/clarify";

type Step = "name" | "type" | "share" | "asks" | "goal" | "facts" | "language" | "notes" | "clarify" | "summary" | "review";

const ASK_OPTIONS: Topic[] = ["price", "hours", "booking", "availability", "address"];
const GOALS: BackupAnswers["goal"][] = ["answer", "orders", "booking", "phone"];
const LANGS: BackupAnswers["language"][] = ["ru", "ky", "both"];

const TOPIC_RU: Record<Topic, string> = {
  price: "Цена",
  hours: "Часы работы",
  booking: "Бронь / запись",
  order: "Заказ",
  address: "Адрес",
  availability: "Наличие",
};

interface Facts {
  hours: string;
  address: string;
  prices: { item: string; amount: string }[];
  availability: string;
}

const emptyFacts = (): Facts => ({ hours: "", address: "", prices: Array.from({ length: 5 }, () => ({ item: "", amount: "" })), availability: "" });

export default function SetupPage() {
  const router = useRouter();
  const { business, setBusiness, goLive, updateSheet } = useStore();
  const { t } = useT();
  const tr = (key: Key) => t(key);
  const [history, setHistory] = useState<Step[]>(["name"]);
  const step = history[history.length - 1];
  const [name, setName] = useState("");
  const [type, setType] = useState<BusinessType | null>(null);
  const [about, setAbout] = useState("");
  const [asks, setAsks] = useState<Topic[]>([]);
  const [goal, setGoal] = useState<BackupAnswers["goal"] | null>(null);
  const [facts, setFacts] = useState<Facts>(emptyFacts);
  const [language, setLanguage] = useState<BackupAnswers["language"] | null>(null);
  const [notes, setNotes] = useState("");

  const go = (s: Step) => setHistory((h) => [...h, s]);
  const back = () => setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h));

  // Questions for whatever isn't clear, one per screen, then the summary.
  const [clarifyBase, setClarifyBase] = useState<Sheet | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  function startClarify(b: Business, replaceCurrent = false) {
    setBusiness(b);
    const qs = buildQuestions(b.sheet);
    setClarifyBase(b.sheet);
    setQuestions(qs);
    setAnswers({});
    const next: Step = qs.length > 0 ? "clarify" : "summary";
    setHistory((h) => (replaceCurrent ? [...h.slice(0, -1), next] : [...h, next]));
  }

  const buildFromBackup = () => {
    const t = type ?? "other";
    const owner = { by: "owner" as const, at: Date.now() };
    const sheet: Sheet = {
      name: name.trim() || "Мой бизнес",
      type: t,
      ...(about.trim() ? { about: about.trim() } : {}),
      language: language ?? "both",
      hours: facts.hours.trim(),
      address: facts.address.trim(),
      hours_source: facts.hours.trim() ? owner : undefined,
      address_source: facts.address.trim() ? owner : undefined,
      prices: facts.prices
        .filter((p) => p.item.trim() && p.amount.trim())
        .map((p, i) => ({ id: `p${i}`, item: p.item.trim(), amount: Number(p.amount), currency: "сом", needs_check: false, source: owner })),
      availability: facts.availability.trim() ? [{ id: "a0", text: facts.availability.trim(), needs_check: false, source: owner }] : [],
      top_questions: asks.map((a) => TOPIC_RU[a]),
      tone_examples: [],
      allowed_topics: ALLOWED_TOPICS,
    };
    const b: Business = {
      id: `biz-${Date.now()}`,
      sheet,
      chats: [testChat()],
      imported_history: false,
      live: false,
      backup: { asks, goal: goal ?? "answer", language: language ?? "ru", notes },
    };
    startClarify(b);
  };

  const order: Step[] = ["name", "type", "share", "asks", "goal", "facts", "language", "notes", "clarify", "summary"];
  const pct = Math.round(((order.indexOf(step === "review" ? "summary" : step) + 1) / order.length) * 100);
  const factsEmpty = !facts.hours.trim() && !facts.address.trim() && !facts.availability.trim() && facts.prices.every((p) => !p.item.trim());

  const Back = () => (history.length > 1 ? <button className="ghost" onClick={back}>{t("back")}</button> : <span />);

  if (step === "clarify" && clarifyBase) {
    return (
      <main className="page narrow">
        <div className="steps">{t("setup_clarify_steps")}</div>
        <Clarify
          sheet={clarifyBase}
          questions={questions}
          answers={answers}
          onAnswer={(id, a) => setAnswers((all) => ({ ...all, [id]: a }))}
          onDone={(all) => {
            setAnswers(all);
            updateSheet(() => applyAnswers(clarifyBase, questions, all, Date.now()));
            go("summary");
          }}
          onExit={back}
          fromChats={business?.imported_history ?? false}
        />
      </main>
    );
  }

  if (step === "summary") {
    return (
      <main className="page">
        <div className="row between">
          <Back />
        </div>
        <SheetSummary
          mode="wizard"
          onApprove={() => {
            goLive();
            router.push("/live");
          }}
          onEditDetails={() => go("review")}
        />
      </main>
    );
  }

  if (step === "review") {
    return (
      <main className="page">
        <div className="row between">
          <Back />
        </div>
        <ReviewSheet
          mode="wizard"
          onDone={() => {
            goLive();
            router.push("/live");
          }}
        />
      </main>
    );
  }

  return (
    <main className="page narrow">
      <div className="steps">{t("setup_steps")}</div>
      <div className="progress"><div style={{ width: `${pct}%` }} /></div>

      <div className="card stack">
        {step === "name" && (
          <>
            <h1>{t("name_q")}</h1>
            <input type="text" autoFocus value={name} placeholder="Обувь 10" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && go("type")} />
            <div className="row between"><Back /><button className="primary" disabled={!name.trim()} onClick={() => go("type")}>{t("next")}</button></div>
          </>
        )}

        {step === "type" && (
          <>
            <h1>{t("type_q")}</h1>
            <div className="choices">
              {BUSINESS_TYPES.map((t) => (
                <button key={t.id} className={`choice ${type === t.id ? "on" : ""}`} onClick={() => setType(t.id)}>{tr(`type_${t.id}`)}</button>
              ))}
            </div>
            {type ? (
              // "Other" says nothing about the business, so there the owner must describe it.
              <label className="field">
                <span>{t("about_q")}{type === "other" ? null : <span className="muted small"> · {t("about_optional")}</span>}</span>
                <input type="text" maxLength={80} value={about} placeholder={t("about_ph")} autoFocus={type === "other"} onChange={(e) => setAbout(e.target.value)} />
              </label>
            ) : null}
            {type && type !== "other" ? <p className="muted small">{t("customers_might_ask", { example: EMPTY_STATE_EXAMPLE[type] })}</p> : null}
            <div className="row between"><Back /><button className="primary" disabled={!type || (type === "other" && !about.trim())} onClick={() => go("share")}>{t("next")}</button></div>
          </>
        )}


        {step === "share" && (
          <>
            <h1>{t("share_q")}</h1>
            <p>{t("share_body")}</p>
            <div className="notice">
              {t("share_privacy")}
              <br />
              <span className="small muted">{t("share_groups")}</span>
            </div>
            <div className="row between">
              <Back />
              <button className="primary" onClick={() => go("asks")}>{t("next")}</button>
            </div>
          </>
        )}

        {step === "asks" && (
          <>
            <h1>{t("asks_q")}</h1>
            <p className="muted">{t("pick_all")}</p>
            <div className="choices">
              {ASK_OPTIONS.map((o) => (
                <button key={o} className={`choice ${asks.includes(o) ? "on" : ""}`} onClick={() => setAsks((a) => (a.includes(o) ? a.filter((x) => x !== o) : [...a, o]))}>
                  {asks.includes(o) ? "✓ " : ""}{t(`topic_${o}`)}
                </button>
              ))}
            </div>
            <div className="row between"><Back /><button className="primary" disabled={asks.length === 0} onClick={() => go("goal")}>{t("next")}</button></div>
          </>
        )}

        {step === "goal" && (
          <>
            <h1>{t("goal_q")}</h1>
            <div className="choices">
              {GOALS.map((g) => (
                <button key={g} className={`choice ${goal === g ? "on" : ""}`} onClick={() => setGoal(g)}>{t(`goal_${g}`)}</button>
              ))}
            </div>
            <div className="row between"><Back /><button className="primary" disabled={!goal} onClick={() => go("facts")}>{t("next")}</button></div>
          </>
        )}

        {step === "facts" && (
          <>
            <h1>{t("facts_title")}</h1>
            <p className="muted">{t("facts_body")}</p>
            <label className="field"><span>{t("hours")}</span><input type="text" value={facts.hours} placeholder="09:00–22:00" onChange={(e) => setFacts({ ...facts, hours: e.target.value })} /></label>
            <label className="field"><span>{t("address")}</span><input type="text" value={facts.address} placeholder="Бишкек, ул. Киевская 100" onChange={(e) => setFacts({ ...facts, address: e.target.value })} /></label>
            <div>
              <span className="muted small">{t("up_to_5")}</span>
              {facts.prices.map((p, i) => (
                <div key={i} className="row" style={{ flexWrap: "nowrap", marginTop: 6 }}>
                  <input type="text" value={p.item} placeholder={i === 0 ? (type === "cafe" ? "Лагман" : t("item_ph")) : ""} aria-label={t("item_n", { n: i + 1 })}
                    onChange={(e) => setFacts({ ...facts, prices: facts.prices.map((x, j) => (j === i ? { ...x, item: e.target.value } : x)) })} />
                  <input type="number" value={p.amount} placeholder="сом" style={{ maxWidth: 110 }} aria-label={t("price_n", { n: i + 1 })}
                    onChange={(e) => setFacts({ ...facts, prices: facts.prices.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)) })} />
                </div>
              ))}
            </div>
            <label className="field"><span>{t("avail_note")}</span><input type="text" value={facts.availability} placeholder={AVAILABILITY_EXAMPLE[type ?? "other"]} onChange={(e) => setFacts({ ...facts, availability: e.target.value })} /></label>
            {factsEmpty ? <div className="notice warn small">{t("no_facts_warn")}</div> : null}
            <div className="row between"><Back /><button className="primary" onClick={() => go("language")}>{t("next")}</button></div>
          </>
        )}

        {step === "language" && (
          <>
            <h1>{t("language_q")}</h1>
            <div className="choices">
              {LANGS.map((l) => (
                <button key={l} className={`choice ${language === l ? "on" : ""}`} onClick={() => setLanguage(l)}>{t(`lang_${l}`)}</button>
              ))}
            </div>
            {language === "both" ? <p className="muted small">{t("both_note")}</p> : null}
            <div className="row between"><Back /><button className="primary" disabled={!language} onClick={() => go("notes")}>{t("next")}</button></div>
          </>
        )}

        {step === "notes" && (
          <>
            <h1>{t("notes_q")}</h1>
            <p className="muted">{t("optional")}</p>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("notes_ph")} />
            <div className="row between"><Back /><button className="primary" onClick={buildFromBackup}>{t("review_btn")}</button></div>
          </>
        )}
      </div>
    </main>
  );
}
