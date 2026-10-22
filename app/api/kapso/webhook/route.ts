import { after, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { receiveWebhook } from "@/lib/whatsapp/webhook";

// AI replies can take a few seconds; allow up to a minute after answering Kapso.
export const maxDuration = 60;

/** Kapso pushes WhatsApp messages here. Answer at once, reply to the customer afterwards. */
export async function POST(req: Request) {
  const raw = await req.text();
  const result = await receiveWebhook(await getDb(), raw, req.headers.get("x-webhook-signature"), req.headers.get("x-webhook-event"));
  if (result.status !== 200) return NextResponse.json({ error: result.error }, { status: result.status });
  if (result.work) after(result.work);
  return NextResponse.json({ ok: true });
}
