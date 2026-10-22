import { NextResponse } from "next/server";
import { llmEnabled, llmModel } from "@/lib/llm";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ai: llmEnabled(), model: llmEnabled() ? llmModel() : null });
}
