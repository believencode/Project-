import type { BotIntent, Chat, Message, Sheet } from "./types";
import { OFF_TOPIC_TOPICS, businessLine } from "./copy";
import { checkMessage } from "./guard";
import { jsonCall, languageRule } from "./llm";
import { historyOf } from "./engine";

/**
 * Server only. The AI writes every bot message: code has already decided what
 * to say (the intent); the model decides how to say it, in the business's tone
 * and the customer's language. Every message passes the guard before it's sent.
 */

const SLOT_WORDS: Record<string, string> = {
  item: "which item they want",
  size: "which size they need",
  day: "which day",
  time: "what time",
  people: "for how many people",
};

function instruction(intent: BotIntent, sheet: Sheet): string {
  switch (intent.type) {
    case "greeting":
      return "The customer greeted you, thanked you or said goodbye. Reply briefly and warmly. If it is a hello, offer help.";
    case "off_topic":
      return `The customer asked about something the business doesn't handle. Politely say you can only help with: ${OFF_TOPIC_TOPICS[sheet.type]}. Say a staff member will reply if they need something else. Do not answer or comment on their request.`;
    case "handoff":
      return "Tell the customer a staff member will reply to them personally. Do not answer their request.";
    case "missing":
      return "You don't have this information. Tell the customer a staff member will check and reply. Do not guess the answer.";
    case "cancelled":
      return "The customer called off their booking or order. Acknowledge briefly and say they can write any time.";
    case "ask_slot": {
      const what = `Ask one short question to find out ${SLOT_WORDS[intent.slot]} for their ${intent.kind}.`;
      const opts = intent.options?.length ? ` You can mention the options: ${intent.options.join(", ")}.` : "";
      return intent.retry ? `You didn't understand their last answer. Say so briefly, then: ${what}${opts}` : `${what}${opts}`;
    }
    case "draft_done":
      return `Tell the customer you've noted their ${intent.kind}: ${intent.summary}. Say a staff member will confirm it here in the chat. Do not say it is confirmed.`;
    case "confirmed":
      return `Tell the customer their ${intent.kind} is confirmed: ${intent.summary}.${intent.kind === "booking" ? " Say you look forward to seeing them." : " Thank them."}`;
    case "declined":
      return `Apologise and tell the customer their ${intent.kind} (${intent.summary}) can't be confirmed. Say a staff member will write to them.`;
    case "answer":
    case "follow_up":
      return "";
  }
}

const WRITER_SYSTEM = `You write one WhatsApp message on behalf of a small business in Bishkek.
Say exactly what the instruction asks — nothing more. Never add prices, sizes, times, addresses, discounts or promises that aren't in the instruction.
At most 2 short sentences. Sound like the staff examples: friendly, natural, no bureaucratic phrasing. No emoji unless the staff examples use them.
Write in the language given in <language>, in Cyrillic letters only. Greet only if the conversation has no bot message yet.`;

async function writeOne(intent: BotIntent, sheet: Sheet, chat: Chat, customerTexts: string[], hint?: string): Promise<string> {
  const history = historyOf(chat, 6)
    .map((h) => `${h.from === "customer" ? "Customer" : h.from === "staff" ? "Staff" : "Bot"}: ${h.text}`)
    .join("\n");
  const { text } = await jsonCall<{ text: string }>(
    WRITER_SYSTEM,
    `<business>${businessLine(sheet)}</business>
<staff_examples>${sheet.tone_examples.join("\n")}</staff_examples>
<language>${languageRule(sheet, customerTexts.at(-1) ?? "")}</language>
<conversation>\n${history}\n</conversation>
<instruction>${instruction(intent, sheet)}</instruction>${hint ? `\n<fix>Your previous attempt was rejected: ${hint}. Write it again without that problem.</fix>` : ""}`,
    {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
  );
  return text.trim();
}

/** Thrown when a message can't be written safely; the caller hands the chat to a person. */
export class WriterError extends Error {}

/**
 * Write (or check) every bot message added in this turn. Answers from the reply
 * model are checked; if one fails the guard it becomes "a staff member will
 * check". Everything else is written from its intent, with one retry.
 */
export async function writeNewMessages(before: Chat, written: Chat, sheet: Sheet): Promise<Chat> {
  let after = written;
  const known = new Set(before.messages.map((m) => m.id));
  const customerTexts = after.messages.filter((m) => m.from === "customer").slice(-6).map((m) => m.text);
  const messages: Message[] = [];

  for (const m of written.messages) {
    if (known.has(m.id) || m.from !== "bot" || !m.intent) {
      messages.push(m);
      continue;
    }
    let intent = m.intent;
    // The reply model's own answer: keep it if it passes the guard.
    if (m.written_by === "ai" && (intent.type === "answer" || intent.type === "follow_up")) {
      if (checkMessage(m.text, { intent, sheet, customerTexts }).ok) {
        messages.push(m);
        continue;
      }
      intent = { type: "missing" };
      const asked = customerTexts.at(-1) ?? "";
      after = { ...after, needs_person: { reason: "Missing answer", details: [...(after.needs_person?.reason === "Missing answer" ? after.needs_person.details : []), asked].slice(-3) } };
    }
    const chatSoFar: Chat = { ...after, messages };
    let text = await writeOne(intent, sheet, chatSoFar, customerTexts);
    let check = checkMessage(text, { intent, sheet, customerTexts });
    if (!check.ok) {
      text = await writeOne(intent, sheet, chatSoFar, customerTexts, check.reason);
      check = checkMessage(text, { intent, sheet, customerTexts });
    }
    if (!check.ok) throw new WriterError(`could not write a safe ${intent.type} message: ${check.reason}`);
    messages.push({ ...m, text, intent, written_by: "ai" });
  }
  return { ...after, messages };
}
