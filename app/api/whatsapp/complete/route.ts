import { NextResponse } from "next/server";
import { currentBusiness } from "@/lib/session";
import { KapsoError, kapsoEnabled } from "@/lib/kapso";
import { completeSetup } from "@/lib/whatsapp/connect";

export const dynamic = "force-dynamic";

/**
 * The owner is back from the setup page (or taps "check"): connect the number they
 * just linked. { status: "pending" } means Kapso hasn't finished yet; ask again shortly.
 */
export async function POST(req: Request) {
  const ctx = await currentBusiness();
  if (ctx instanceof NextResponse) return ctx;
  if (!kapsoEnabled()) return NextResponse.json({ error: "WhatsApp connection isn't available yet. Contact Jardamchy support." }, { status: 503 });
  const { phone_number_id } = (await req.json().catch(() => ({}))) as { phone_number_id?: string };
  try {
    const r = await completeSetup(ctx.db, ctx.row, phone_number_id || undefined);
    if (r.status === "error") return NextResponse.json({ error: r.error }, { status: r.code });
    return NextResponse.json(r);
  } catch (err) {
    console.error("Could not finish connecting WhatsApp:", err instanceof KapsoError ? err.message : err);
    return NextResponse.json({ status: "pending" });
  }
}
