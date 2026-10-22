import type { Chat, Message, ReplyDecision, Sheet } from "./types";
import { decideWithRules } from "./rules";
import { decideWithLLM, llmEnabled } from "./llm";
import { historyOf, needsClassification, receiveClassified, receiveUnclassified, receiveWithoutAI } from "./engine";
import { writeNewMessages } from "./writer";

/**
 * Server only. One customer message in, the updated chat out: classify, decide,
 * write, check. Used by the web app and by the WhatsApp bridge, so both behave
 * exactly the same.
 */
export interface TurnResult {
  chat: Chat;
  decision: ReplyDecision | null;
  ai_error?: boolean;
}

export async function runTurn(chat: Chat, sheet: Sheet, text: string, kind: Message["kind"] = "text", now = Date.now()): Promise<TurnResult> {
  if (!needsClassification(chat, kind, now)) {
    return { chat: receiveUnclassified(chat, text, kind, now), decision: null };
  }

  if (!llmEnabled()) {
    // Demo mode without an AI key: keyword rules and fixed lines.
    const decision = decideWithRules(text, sheet, historyOf(chat), chat.draft);
    return { chat: receiveClassified(chat, text, decision, sheet, now), decision };
  }

  try {
    const decision = await decideWithLLM(text, sheet, historyOf(chat), chat.draft);
    const decided = receiveClassified(chat, text, decision, sheet, now);
    return { chat: await writeNewMessages(chat, decided, sheet), decision };
  } catch (err) {
    // No canned fallback: the message waits for a person.
    console.error("AI turn failed, handing to a person:", err);
    return { chat: receiveWithoutAI(chat, text, now), decision: null, ai_error: true };
  }
}
