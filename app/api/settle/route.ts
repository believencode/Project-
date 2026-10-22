import { NextResponse } from "next/server";
import type { Chat, Sheet } from "@/lib/types";
import { llmEnabled } from "@/lib/llm";
import { settleRequest } from "@/lib/engine";
import { writeNewMessages } from "@/lib/writer";

/** Staff confirm or decline a request; the AI writes the message to the customer. */
export async function POST(req: Request) {
  const { chat, sheet, requestId, ok } = (await req.json()) as { chat: Chat; sheet: Sheet; requestId: string; ok: boolean };
  if (!chat || !sheet || !requestId) {
    return NextResponse.json({ error: "chat, sheet and requestId are required" }, { status: 400 });
  }
  const settled = settleRequest(chat, requestId, ok, Date.now());
  if (!llmEnabled()) return NextResponse.json({ chat: settled });
  try {
    return NextResponse.json({ chat: await writeNewMessages(chat, settled, sheet) });
  } catch (err) {
    console.error("AI could not write the confirmation:", err);
    return NextResponse.json({ error: "The AI could not write the message. Try again, or reply to the customer yourself." }, { status: 503 });
  }
}
