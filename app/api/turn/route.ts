import { NextResponse } from "next/server";
import type { Chat, Message, ReplyDecision, Sheet } from "@/lib/types";
import { decideWithRules } from "@/lib/rules";
import { decideWithLLM, llmEnabled } from "@/lib/llm";
import { historyOf, needsClassification, receiveClassified, receiveUnclassified, receiveWithoutAI } from "@/lib/engine";
import { writeNewMessages } from "@/lib/writer";

/** One customer message in, the updated chat out: classify, decide, write, check. */
export async function POST(req: Request) {
  const { chat, sheet, text, kind = "text" } = (await req.json()) as {
    chat: Chat;
    sheet: Sheet;
    text: string;
    kind?: Message["kind"];
  };
  if (!chat || !sheet || typeof text !== "string") {
    return NextResponse.json({ error: "chat, sheet and text are required" }, { status: 400 });
  }
  const now = Date.now();

  if (!needsClassification(chat, kind, now)) {
    return NextResponse.json({ chat: receiveUnclassified(chat, text, kind, now), decision: null });
  }

  if (!llmEnabled()) {
    // Demo mode without an AI key: keyword rules and fixed lines.
    const decision = decideWithRules(text, sheet, historyOf(chat), chat.draft);
    return NextResponse.json({ chat: receiveClassified(chat, text, decision, sheet, now), decision });
  }

  try {
    const decision: ReplyDecision = await decideWithLLM(text, sheet, historyOf(chat), chat.draft);
    const decided = receiveClassified(chat, text, decision, sheet, now);
    const written = await writeNewMessages(chat, decided, sheet);
    return NextResponse.json({ chat: written, decision });
  } catch (err) {
    // No canned fallback: the message waits for a person.
    console.error("AI turn failed, handing to a person:", err);
    return NextResponse.json({ chat: receiveWithoutAI(chat, text, now), decision: null, ai_error: true });
  }
}
