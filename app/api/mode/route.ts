import { NextResponse } from "next/server";
import { llmEnabled } from "@/lib/llm";

export const dynamic = "force-dynamic";

export function GET() {
  // Which AI model runs is not shown to owners.
  return NextResponse.json({ ai: llmEnabled() });
}
