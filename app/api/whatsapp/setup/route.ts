import { NextResponse } from "next/server";
import { currentBusiness } from "@/lib/session";
import { KapsoError, kapsoEnabled } from "@/lib/kapso";
import { startSetup } from "@/lib/whatsapp/connect";

export const dynamic = "force-dynamic";

/** Start connecting the owner's own WhatsApp Business number: returns the setup page to open. */
export async function POST(req: Request) {
  const ctx = await currentBusiness();
  if (ctx instanceof NextResponse) return ctx;
  if (!kapsoEnabled()) return NextResponse.json({ error: "WhatsApp connection isn't available yet. Contact Jardamchy support." }, { status: 503 });
  try {
    const url = await startSetup(ctx.db, ctx.row, new URL(req.url).origin);
    return NextResponse.json({ url });
  } catch (err) {
    console.error("Could not create a setup link:", err instanceof KapsoError ? err.message : err);
    return NextResponse.json({ error: "Couldn't connect the number. Try again." }, { status: 502 });
  }
}
