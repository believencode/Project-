import { NextResponse } from "next/server";
import type { Chat, Message, Sheet } from "@/lib/types";
import { runTurn } from "@/lib/turn";

// AI calls can take several seconds.
export const maxDuration = 60;

/** One customer message in, the updated chat out. */
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
  return NextResponse.json(await runTurn(chat, sheet, text, kind));
}
