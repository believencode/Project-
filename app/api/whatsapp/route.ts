import { NextResponse } from "next/server";
import { publicUrl } from "@/lib/url";
import { currentBusiness } from "@/lib/session";
import { KapsoError, kapsoEnabled, listPhoneNumbers } from "@/lib/kapso";
import { connectNumber, view, visibleNumbers } from "@/lib/whatsapp/connect";

export const dynamic = "force-dynamic";

/**
 * Is WhatsApp set up on this server, which number is this business on, and which
 * numbers may it connect (its own and the shared test number, never another business's)?
 */
export async function GET() {
  const ctx = await currentBusiness();
  if (ctx instanceof NextResponse) return ctx;
  if (!kapsoEnabled()) return NextResponse.json({ available: false, connected: null, numbers: [] });
  const mode = publicUrl() ? "webhook" : "polling";
  try {
    const numbers = visibleNumbers(await listPhoneNumbers(), ctx.row.kapso_customer_id);
    const connected = ctx.row.kapso_phone_number_id;
    return NextResponse.json({
      available: true,
      mode,
      connected,
      numbers: numbers.map(view),
    });
  } catch (err) {
    // The provider's own error stays in the log; owners see a plain message.
    console.error("Could not list WhatsApp numbers:", err instanceof KapsoError ? err.message : err);
    return NextResponse.json({ available: true, mode, connected: ctx.row.kapso_phone_number_id, numbers: [], error: "Couldn't load WhatsApp numbers. Try again later." });
  }
}

/** Connect this business to one of its numbers ({ id }), or disconnect ({ id: null }). */
export async function POST(req: Request) {
  const ctx = await currentBusiness();
  if (ctx instanceof NextResponse) return ctx;
  const { db, row } = ctx;
  const { id } = (await req.json()) as { id: string | null };
  if (id) {
    const numbers = visibleNumbers(await listPhoneNumbers().catch(() => []), row.kapso_customer_id);
    if (!numbers.some((n) => n.phone_number_id === id)) return NextResponse.json({ error: "That number isn't available to connect." }, { status: 400 });
  }
  const r = await connectNumber(db, row, id);
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status });
}
