/**
 * Connects the bot to a real WhatsApp number through Kapso (the sandbox for now).
 *
 *   KAPSO_API_KEY=... [LLM_PROVIDER=gemini GEMINI_API_KEY=...] npm run kapso
 *
 * Every few seconds it asks Kapso for new messages (no public URL needed),
 * runs each customer message through the same bot logic as the web app, and
 * sends the replies. Staff replies from the WhatsApp Business app pause the bot
 * in that chat. State is kept in data/kapso-bridge.json.
 *
 * Production will use Kapso webhooks instead of polling.
 */
import fs from "node:fs";
import path from "node:path";
import type { Chat, Sheet } from "../lib/types";
import { shoeChats, shoeSheet } from "../lib/fixtures";
import { attachSources } from "../lib/sources";
import { staffReply } from "../lib/engine";
import { runTurn } from "../lib/turn";
import { llmEnabled, llmModel } from "../lib/llm";
import { KapsoError, listMessages, listPhoneNumbers, sendText, type KapsoMessage } from "../lib/kapso";

const STATE_FILE = path.resolve("data/kapso-bridge.json");
const POLL_MS = 3000;
const ONCE = process.argv.includes("--once");

interface State {
  phoneNumberId: string;
  sheet: Sheet;
  chats: Chat[];
  /** Messages newer than this are fetched (ISO); a small overlap is deduplicated by `seen`. */
  since: string;
  /** When the bridge first started on this number: older messages are never answered. */
  startedAt?: string;
  seen: string[];
}

/** The demo shoe shop with every fact confirmed, until the web app saves a real sheet here. */
function demoSheet(): Sheet {
  const s = attachSources(shoeSheet(), shoeChats(Date.now()));
  return {
    ...s,
    prices: s.prices.map((p) => ({ ...p, needs_check: false, alternatives: undefined })),
    availability: s.availability.map((n) => ({ ...n, needs_check: false })),
  };
}

async function loadState(): Promise<State> {
  if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as State;
  const numbers = await listPhoneNumbers();
  const number = process.env.KAPSO_PHONE_NUMBER_ID
    ? numbers.find((n) => n.phone_number_id === process.env.KAPSO_PHONE_NUMBER_ID)
    : // A WhatsApp Business app number (what clients connect) wins over the sandbox.
      (numbers.find((n) => n.is_coexistence) ?? numbers.find((n) => n.kind !== "sandbox") ?? numbers[0]);
  if (!number) throw new Error("No WhatsApp number in this Kapso project.");
  return {
    phoneNumberId: number.phone_number_id,
    sheet: demoSheet(),
    chats: [],
    // Start from now: don't answer messages sent before the bridge was first started.
    since: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    seen: [],
  };
}

function saveState(s: State) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify({ ...s, seen: s.seen.slice(-1000) }, null, 1));
}

function chatFor(s: State, waId: string, name?: string): Chat {
  const id = `wa:${waId}`;
  let chat = s.chats.find((c) => c.id === id);
  if (!chat) {
    chat = {
      id,
      customer: name || `+${waId}`,
      phone: `+${waId}`,
      messages: [],
      off_topic_count: 0,
      ai_stopped: false,
      paused_until: null,
      needs_person: null,
    };
    s.chats.push(chat);
  }
  return chat;
}

const KIND: Record<string, Chat["messages"][number]["kind"]> = { audio: "voice", voice: "voice", image: "photo", sticker: "photo" };

async function handleInbound(s: State, m: KapsoMessage) {
  const waId = m.from!;
  const before = chatFor(s, waId, m.kapso?.contact_name);
  const text = m.text?.body ?? "";
  const kind = m.type === "text" ? "text" : (KIND[m.type] ?? "photo");
  const at = Number(m.timestamp) * 1000;
  const result = await runTurn(before, s.sheet, text, kind, Math.max(at, Date.now()));
  const replies = result.chat.messages.slice(before.messages.length).filter((x) => x.from === "bot");

  const label = result.decision?.label ?? (result.ai_error ? "AI unavailable" : "not classified");
  console.log(`← ${before.phone} «${kind === "text" ? text : `[${m.type}]`}» [${label}]`);
  for (const r of replies) {
    try {
      await sendText(s.phoneNumberId, waId, r.text);
      console.log(`→ ${before.phone} «${r.text}» (${r.written_by === "ai" ? "AI" : "fixed line"})`);
    } catch (err) {
      console.error(`✗ could not send to ${before.phone}: ${err instanceof KapsoError ? err.message : err}`);
    }
  }
  if (result.chat.needs_person && !before.needs_person) console.log(`! ${before.phone} needs a person: ${result.chat.needs_person.reason}`);
  s.chats = s.chats.map((c) => (c.id === before.id ? result.chat : c));
}

/** Staff answered from the WhatsApp Business app on the phone: pause the bot in that chat. */
function handleStaffEcho(s: State, m: KapsoMessage) {
  const chat = chatFor(s, m.to!);
  s.chats = s.chats.map((c) => (c.id === chat.id ? staffReply(c, m.text?.body ?? "", Number(m.timestamp) * 1000, "echo") : c));
  console.log(`⏸ staff replied to ${chat.phone} from the phone — bot paused 30 min in that chat`);
}

async function poll(s: State) {
  const since = new Date(s.since);
  const [inbound, outbound] = await Promise.all([
    listMessages(s.phoneNumberId, { since, direction: "inbound" }),
    listMessages(s.phoneNumberId, { since, direction: "outbound" }),
  ]);
  // Imported history (origin "history_sync") is never answered, and messages older than the bridge's
  // first start are skipped too: a customer from months ago must not get a reply now.
  const startedAt = Date.parse(s.startedAt ?? s.since);
  const isLive = (m: KapsoMessage) => m.kapso?.origin !== "history_sync" && Number(m.timestamp) * 1000 >= startedAt - 5_000;
  const fresh = [...inbound, ...outbound.filter((m) => m.kapso?.origin === "business_app")]
    .filter((m) => isLive(m) && !s.seen.includes(m.id))
    .sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
  for (const m of fresh) {
    s.seen.push(m.id);
    if (m.kapso?.direction === "outbound") handleStaffEcho(s, m);
    else await handleInbound(s, m);
    saveState(s);
  }
  const newest = [...inbound, ...outbound].reduce((t, m) => Math.max(t, Number(m.timestamp) * 1000), since.getTime());
  // Keep a 60s overlap: Kapso may list a message a moment after its timestamp.
  s.since = new Date(Math.max(since.getTime(), newest - 60_000)).toISOString();
  saveState(s);
}

const state = await loadState();
saveState(state);
console.log(`Kapso bridge · number ${state.phoneNumberId} · bot: ${llmEnabled() ? `AI (${llmModel()})` : "demo mode (keyword rules, fixed lines)"}`);
console.log(`Answering from: ${state.sheet.name}. Checking for messages every ${POLL_MS / 1000}s. Ctrl+C to stop.\n`);

for (;;) {
  try {
    await poll(state);
  } catch (err) {
    console.error(`✗ ${err instanceof KapsoError ? err.message : err}`);
  }
  if (ONCE) break;
  await new Promise((r) => setTimeout(r, POLL_MS));
}
