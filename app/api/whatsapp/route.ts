import { NextResponse } from "next/server";
import { currentBusiness } from "@/lib/session";
import { connectWhatsApp } from "@/lib/repo";
import { KapsoError, listPhoneNumbers } from "@/lib/kapso";

export const dynamic = "force-dynamic";

/** Is WhatsApp (Kapso) set up on this server, and which number is this business on? */
export async function GET() {
  const ctx = await currentBusiness();
  if (ctx instanceof NextResponse) return ctx;
  if (!process.env.KAPSO_API_KEY) return NextResponse.json({ available: false, connected: null, numbers: [] });
  try {
    const numbers = await listPhoneNumbers();
    return NextResponse.json({
      available: true,
      connected: ctx.row.kapso_phone_number_id,
      numbers: numbers.map((n) => ({ id: n.phone_number_id, name: n.display_name, sandbox: n.kind === "sandbox", business_app: n.is_coexistence })),
    });
  } catch (err) {
    return NextResponse.json({ available: true, connected: ctx.row.kapso_phone_number_id, numbers: [], error: err instanceof KapsoError ? err.message : String(err) });
  }
}

/** Connect this business to a Kapso number ({ id }), or disconnect ({ id: null }). */
export async function POST(req: Request) {
  const ctx = await currentBusiness();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = (await req.json()) as { id: string | null };
  if (id) {
    const numbers = await listPhoneNumbers().catch(() => []);
    if (!numbers.some((n) => n.phone_number_id === id)) return NextResponse.json({ error: "That number isn't in the Kapso project." }, { status: 400 });
    const [taken] = await ctx.db.query("SELECT 1 FROM businesses WHERE kapso_phone_number_id = $1 AND id <> $2", [id, ctx.row.id]);
    if (taken) return NextResponse.json({ error: "That number is already used by another business." }, { status: 409 });
  }
  await connectWhatsApp(ctx.db, ctx.row.id, id);
  return NextResponse.json({ ok: true });
}
