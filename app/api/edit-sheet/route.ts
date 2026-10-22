import { NextResponse } from "next/server";
import type { Sheet } from "@/lib/types";
import { llmEnabled } from "@/lib/llm";
import { validateOps } from "@/lib/edits";
import { opsFromRequest } from "@/lib/editRequest";
import { DEFAULT_LANG, isLang } from "@/lib/i18n";
import { currentOwner } from "@/lib/session";

// AI calls can take several seconds.
export const maxDuration = 60;

/** The owner asks for a change in their own words; the AI proposes edits, code checks them. */
export async function POST(req: Request) {
  // Only a logged-in owner may spend AI calls.
  const owner = await currentOwner();
  if (owner instanceof NextResponse) return owner;
  const { sheet, request, lang: asked } = (await req.json()) as { sheet: Sheet; request: string; lang?: string };
  const lang = isLang(asked) ? asked : DEFAULT_LANG;
  if (!sheet || typeof request !== "string" || !request.trim()) {
    return NextResponse.json({ error: "sheet and request are required" }, { status: 400 });
  }
  if (!llmEnabled()) {
    return NextResponse.json({ error: "Change requests need the AI. In demo mode, use «Edit details by hand»." }, { status: 501 });
  }
  try {
    const { ops, unclear } = await opsFromRequest(sheet, request, lang);
    const { ok, dropped } = validateOps(ops, sheet, request, lang);
    return NextResponse.json({ ops: ok, dropped, unclear });
  } catch (err) {
    console.error("AI could not read the change request:", err);
    return NextResponse.json({ error: "The AI could not read your request. Try again, or use «Edit details by hand»." }, { status: 503 });
  }
}
