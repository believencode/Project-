"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { BackupAnswers, Business, BusinessType, Sheet, Topic } from "@/lib/types";
import { demoBusiness, useStore } from "@/lib/store";
import { testChat } from "@/lib/fixtures";
import { ALLOWED_TOPICS, AVAILABILITY_EXAMPLE, BUSINESS_TYPES, EMPTY_STATE_EXAMPLE } from "@/lib/copy";
import { ReviewSheet } from "@/components/ReviewSheet";
import { Clarify } from "@/components/Clarify";
import { SheetSummary } from "@/components/SheetSummary";
import { attachSources } from "@/lib/sources";
import { applyAnswers, buildQuestions, type Answer, type Question } from "@/lib/clarify";

type Step = "name" | "type" | "connect" | "share" | "reading" | "asks" | "goal" | "facts" | "language" | "notes" | "clarify" | "summary" | "review";

const ASK_OPTIONS: { id: Topic; label: string }[] = [
  { id: "price", label: "Prices" },
  { id: "hours", label: "Hours" },
  { id: "booking", label: "Booking" },
  { id: "availability", label: "Availability" },
  { id: "address", label: "Address" },
];

const GOALS: { id: BackupAnswers["goal"]; label: string }[] = [
  { id: "answer", label: "Answer questions" },
  { id: "orders", label: "Take orders" },
  { id: "booking", label: "Book a time" },
  { id: "phone", label: "Collect a phone number" },
];

const LANGS: { id: BackupAnswers["language"]; label: string }[] = [
  { id: "ru", label: "Russian" },
  { id: "ky", label: "Kyrgyz" },
  { id: "both", label: "Both" },
];

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

/** Fake but stable QR pattern. */
function FakeQR() {
  const cells = useMemo(() => {
    const out: boolean[] = [];
    let x = 7;
    for (let i = 0; i < 21 * 21; i++) {
      x = (x * 1103515245 + 12345) % 2147483648;
      const r = Math.floor(i / 21), c = i % 21;
      const finder = (a: number, b: number) => r >= a && r < a + 7 && c >= b && c < b + 7;
      if (finder(0, 0) || finder(0, 14) || finder(14, 0)) {
        const rr = r % 14 === r ? r : r - 14, cc = c >= 14 ? c - 14 : c;
        const edge = rr === 0 || rr === 6 || cc === 0 || cc === 6;
        const core = rr >= 2 && rr <= 4 && cc >= 2 && cc <= 4;
        out.push(edge || core);
      } else out.push(x % 3 === 0);
    }
    return out;
  }, []);
  return (
    <div className="qr" aria-label="QR code (mock)">
      {cells.map((b, i) => <i key={i} className={b ? "b" : ""} />)}
    </div>
  );
}

export default function SetupPage() {
  const router = useRouter();
  const { business, setBusiness, goLive, updateSheet } = useStore();
  const [history, setHistory] = useState<Step[]>(["name"]);
  const step = history[history.length - 1];
  const [name, setName] = useState("");
  const [type, setType] = useState<BusinessType | null>(null);
  const [asks, setAsks] = useState<Topic[]>([]);
  const [goal, setGoal] = useState<BackupAnswers["goal"] | null>(null);
  const [facts, setFacts] = useState<Facts>(emptyFacts);
  const [language, setLanguage] = useState<BackupAnswers["language"] | null>(null);
  const [notes, setNotes] = useState("");

  const go = (s: Step) => setHistory((h) => [...h, s]);
  const back = () => setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h));

  // "Reading chats": the AI reads the imported chats and drafts the sheet, then the review screen.
  const [readError, setReadError] = useState<string | null>(null);
  const [readTry, setReadTry] = useState(0);
  useEffect(() => {
    if (step !== "reading") return;
    let cancelled = false;
    setReadError(null);
    const kind = type === "cafe" ? "cafe" : "shop";
    const demo = demoBusiness(kind, name.trim() || undefined);
    (async () => {
      let business: Business = { ...demo, sheet_built_by: "demo" };
      try {
        const res = await fetch("/api/build-sheet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chats: demo.chats, type: demo.sheet.type, name: demo.sheet.name }),
        });
        const body = (await res.json()) as { sheet?: Sheet | null; error?: string };
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        if (body.sheet) business = { ...demo, sheet: body.sheet, sheet_built_by: "ai" };
      } catch (err) {
        if (!(err instanceof TypeError)) {
          // The AI is configured but failed: say so instead of showing demo facts as if the AI read them.
          if (!cancelled) setReadError(err instanceof Error ? err.message : "The AI could not read the chats.");
          return;
        }
        // No server at all (static demo): keep the demo facts.
      }
      if (cancelled) return;
      // Link every fact to the chat message it came from, and spot prices that changed over time.
      startClarify({ ...business, sheet: attachSources(business.sheet, business.chats) }, true);
    })();
    return () => {
      cancelled = true;
    };
    // startClarify only changes state; re-running on its identity would re-read the chats.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, type, name, readTry]);

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

  const order: Step[] = ["name", "type", "connect", "share", "asks", "goal", "facts", "language", "notes", "clarify", "summary"];
  const pct = Math.round(((order.indexOf(step === "reading" ? "clarify" : step === "review" ? "summary" : step) + 1) / order.length) * 100);
  const factsEmpty = !facts.hours.trim() && !facts.address.trim() && !facts.availability.trim() && facts.prices.every((p) => !p.item.trim());

  const Back = () => (history.length > 1 && step !== "reading" ? <button className="ghost" onClick={back}>← Back</button> : <span />);

  if (step === "clarify" && clarifyBase) {
    return (
      <main className="page narrow">
        <div className="steps">A few questions to get the facts right</div>
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
      <div className="steps">Set up your WhatsApp bot</div>
      <div className="progress"><div style={{ width: `${pct}%` }} /></div>

      <div className="card stack">
        {step === "name" && (
          <>
            <h1>What is your business called?</h1>
            <input type="text" autoFocus value={name} placeholder="Обувь 10" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && go("type")} />
            <div className="row between"><Back /><button className="primary" disabled={!name.trim()} onClick={() => go("type")}>Next</button></div>
          </>
        )}

        {step === "type" && (
          <>
            <h1>What kind of business is it?</h1>
            <div className="choices">
              {BUSINESS_TYPES.map((t) => (
                <button key={t.id} className={`choice ${type === t.id ? "on" : ""}`} onClick={() => setType(t.id)}>{t.label}</button>
              ))}
            </div>
            {type ? <p className="muted small">Customers might ask: {EMPTY_STATE_EXAMPLE[type]}</p> : null}
            <div className="row between"><Back /><button className="primary" disabled={!type} onClick={() => go("connect")}>Next</button></div>
          </>
        )}

        {step === "connect" && (
          <>
            <h1>Connect WhatsApp</h1>
            <p>Open WhatsApp Business on your phone → Linked devices → scan this code.</p>
            <FakeQR />
            <p className="muted small" style={{ textAlign: "center" }}>
              Your number stays on the WhatsApp Business app. Staff keep replying from the phone as usual.
            </p>
            <div className="row between"><Back /><button className="primary" onClick={() => go("share")}>I scanned it</button></div>
          </>
        )}

        {step === "share" && (
          <>
            <h1>Share your old chats?</h1>
            <p>We read up to 6 months of one-to-one chats to learn your prices, hours, and how your staff reply.</p>
            <div className="notice">
              Chats are used only to answer this business. They are not used to train a public model. You can delete them.
              <br />
              <span className="small muted">Group chats are not included.</span>
            </div>
            <div className="row between">
              <Back />
              <div className="row">
                <button onClick={() => go("asks")}>Skip</button>
                <button className="primary" onClick={() => go("reading")}>Share 6 months</button>
              </div>
            </div>
          </>
        )}

        {step === "reading" && (
          <div style={{ textAlign: "center" }}>
            <h1>Reading chats</h1>
            {readError ? (
              <>
                <div className="notice warn">{readError}</div>
                <div className="row" style={{ justifyContent: "center" }}>
                  <button onClick={() => setHistory((h) => [...h.slice(0, -1), "asks"])}>Skip and answer questions</button>
                  <button className="primary" onClick={() => setReadTry((n) => n + 1)}>Try again</button>
                </div>
              </>
            ) : (
              <div className="spinner" />
            )}
            <p className="muted">The AI is reading one-to-one chats from the last 6 months to learn your prices, hours and how your staff reply. Group chats are skipped.</p>
            {type !== "cafe" && type !== "shop" ? (
              <p className="small muted">Prototype: this uses the demo shoe shop chats.</p>
            ) : null}
          </div>
        )}

        {step === "asks" && (
          <>
            <h1>What do customers ask about?</h1>
            <p className="muted">Pick all that apply.</p>
            <div className="choices">
              {ASK_OPTIONS.map((o) => (
                <button key={o.id} className={`choice ${asks.includes(o.id) ? "on" : ""}`} onClick={() => setAsks((a) => (a.includes(o.id) ? a.filter((x) => x !== o.id) : [...a, o.id]))}>
                  {asks.includes(o.id) ? "✓ " : ""}{o.label}
                </button>
              ))}
            </div>
            <div className="row between"><Back /><button className="primary" disabled={asks.length === 0} onClick={() => go("goal")}>Next</button></div>
          </>
        )}

        {step === "goal" && (
          <>
            <h1>What should the bot do?</h1>
            <div className="choices">
              {GOALS.map((g) => (
                <button key={g.id} className={`choice ${goal === g.id ? "on" : ""}`} onClick={() => setGoal(g.id)}>{g.label}</button>
              ))}
            </div>
            <div className="row between"><Back /><button className="primary" disabled={!goal} onClick={() => go("facts")}>Next</button></div>
          </>
        )}

        {step === "facts" && (
          <>
            <h1>Basic facts</h1>
            <p className="muted">The bot answers only from these. Every field is optional.</p>
            <label className="field"><span>Hours</span><input type="text" value={facts.hours} placeholder="09:00–22:00" onChange={(e) => setFacts({ ...facts, hours: e.target.value })} /></label>
            <label className="field"><span>Address</span><input type="text" value={facts.address} placeholder="Бишкек, ул. Киевская 100" onChange={(e) => setFacts({ ...facts, address: e.target.value })} /></label>
            <div>
              <span className="muted small">Up to 5 prices</span>
              {facts.prices.map((p, i) => (
                <div key={i} className="row" style={{ flexWrap: "nowrap", marginTop: 6 }}>
                  <input type="text" value={p.item} placeholder={i === 0 ? (type === "cafe" ? "Лагман" : "Товар или услуга") : ""} aria-label={`Item ${i + 1}`}
                    onChange={(e) => setFacts({ ...facts, prices: facts.prices.map((x, j) => (j === i ? { ...x, item: e.target.value } : x)) })} />
                  <input type="number" value={p.amount} placeholder="сом" style={{ maxWidth: 110 }} aria-label={`Price ${i + 1}`}
                    onChange={(e) => setFacts({ ...facts, prices: facts.prices.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)) })} />
                </div>
              ))}
            </div>
            <label className="field"><span>Availability note</span><input type="text" value={facts.availability} placeholder={AVAILABILITY_EXAMPLE[type ?? "other"]} onChange={(e) => setFacts({ ...facts, availability: e.target.value })} /></label>
            {factsEmpty ? <div className="notice warn small">With no facts, the bot can only pass every question to a person.</div> : null}
            <div className="row between"><Back /><button className="primary" onClick={() => go("language")}>Next</button></div>
          </>
        )}

        {step === "language" && (
          <>
            <h1>Which language should the bot use?</h1>
            <div className="choices">
              {LANGS.map((l) => (
                <button key={l.id} className={`choice ${language === l.id ? "on" : ""}`} onClick={() => setLanguage(l.id)}>{l.label}</button>
              ))}
            </div>
            {language === "both" ? <p className="muted small">The bot replies in the customer&apos;s language: Kyrgyz if they write in Kyrgyz, otherwise Russian.</p> : null}
            <div className="row between"><Back /><button className="primary" disabled={!language} onClick={() => go("notes")}>Next</button></div>
          </>
        )}

        {step === "notes" && (
          <>
            <h1>Anything else the bot should know?</h1>
            <p className="muted">Optional.</p>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Например: доставка только по Бишкеку" />
            <div className="row between"><Back /><button className="primary" onClick={buildFromBackup}>Review</button></div>
          </>
        )}
      </div>
    </main>
  );
}
