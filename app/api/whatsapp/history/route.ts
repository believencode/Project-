import { NextResponse } from "next/server";
import { currentBusiness } from "@/lib/session";
import { KapsoError, kapsoEnabled } from "@/lib/kapso";
import { importHistory } from "@/lib/whatsapp/history";

// Fetching months of chats and one AI read can take a while.
export const maxDuration = 60;

/** Copy in the chats the owner shared when connecting WhatsApp, and learn facts from them. */
export async function POST() {
  const ctx = await currentBusiness();
  if (ctx instanceof NextResponse) return ctx;
  if (!kapsoEnabled()) return NextResponse.json({ error: "WhatsApp connection isn't available yet. Contact Jardamchy support." }, { status: 503 });
  if (!ctx.row.kapso_phone_number_id) return NextResponse.json({ error: "Connect a WhatsApp number first (Settings → WhatsApp)." }, { status: 400 });
  try {
    return NextResponse.json(await importHistory(ctx.db, ctx.row));
  } catch (err) {
    console.error("Could not import WhatsApp chats:", err instanceof KapsoError ? err.message : err);
    return NextResponse.json({ error: "The AI could not read the chats. Try again." }, { status: 502 });
  }
}
