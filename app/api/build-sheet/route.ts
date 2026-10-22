import { NextResponse } from "next/server";
import type { BusinessType, Chat } from "@/lib/types";
import { llmEnabled } from "@/lib/llm";
import { buildSheetWithAI } from "@/lib/sheetBuilder";

// AI calls can take several seconds.
export const maxDuration = 60;

/** The AI reads the imported chats and drafts the knowledge sheet. */
export async function POST(req: Request) {
  const { chats, type, name } = (await req.json()) as { chats: Chat[]; type: BusinessType; name: string };
  if (!Array.isArray(chats) || !type) return NextResponse.json({ error: "chats and type are required" }, { status: 400 });
  // Demo mode: the client falls back to the demo facts.
  if (!llmEnabled()) return NextResponse.json({ sheet: null });
  try {
    return NextResponse.json({ sheet: await buildSheetWithAI(chats, type, name) });
  } catch (err) {
    console.error("AI could not read the chats:", err);
    return NextResponse.json({ error: "The AI could not read the chats. Try again." }, { status: 503 });
  }
}
