import { NextResponse } from "next/server";
import { getDb } from "./db";
import { llmEnabled } from "./llm";
import { kapsoEnabled } from "./kapso";

/**
 * Server only. What the deployment is missing, without revealing any key or connection string:
 * open /api/health after deploying.
 */
export async function health() {
  let database: string;
  if (!process.env.DATABASE_URL) {
    database = process.env.VERCEL ? "missing: add DATABASE_URL (Vercel → Storage → connect Neon), then redeploy" : "built-in (PGlite)";
  } else {
    try {
      await (await getDb()).query("SELECT 1");
      database = "ok";
    } catch (err) {
      // pg errors carry a code and a short reason, never the password.
      const e = err as { code?: string; message?: string };
      database = `can't connect: ${[e.code, e.message?.slice(0, 160)].filter(Boolean).join(" ")}`;
    }
  }
  return {
    database,
    ai: llmEnabled() ? "on" : "off: set LLM_PROVIDER",
    ai_key: process.env.APP_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY ? "set" : "missing",
    whatsapp: kapsoEnabled() ? "on" : "off: set KAPSO_API_KEY",
  };
}

export function databaseUnavailable() {
  return NextResponse.json({ error: "The server can't reach the database. Open /api/health to see why." }, { status: 503 });
}
