import { NextResponse } from "next/server";
import type { Sheet } from "@/lib/types";
import { decideWithRules } from "@/lib/rules";
import { decideWithLLM, llmEnabled } from "@/lib/llm";

export async function POST(req: Request) {
  const { text, sheet } = (await req.json()) as { text: string; sheet: Sheet };
  if (typeof text !== "string" || !sheet) {
    return NextResponse.json({ error: "text and sheet are required" }, { status: 400 });
  }

  if (llmEnabled()) {
    try {
      return NextResponse.json(await decideWithLLM(text, sheet));
    } catch (err) {
      // Fall back to rules so the demo keeps working; the test box shows "rules".
      console.error("LLM path failed, using rules:", err);
    }
  }
  return NextResponse.json(decideWithRules(text, sheet));
}
