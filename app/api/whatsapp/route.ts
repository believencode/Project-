import { randomBytes } from "node:crypto";
import { publicUrl } from "@/lib/url";
import { NextResponse } from "next/server";
import { currentBusiness } from "@/lib/session";
import { connectWhatsApp, setWebhook } from "@/lib/repo";
import { KapsoError, createWebhook, deleteWebhook, kapsoEnabled, listPhoneNumbers } from "@/lib/kapso";

export const dynamic = "force-dynamic";

/** The app's public address, if it has one: then Kapso pushes messages by webhook instead of the app polling. */

/** Is WhatsApp (Kapso) set up on this server, and which number is this business on? */
export async function GET() {
  const ctx = await currentBusiness();
  if (ctx instanceof NextResponse) return ctx;
  if (!kapsoEnabled()) return NextResponse.json({ available: false, connected: null, numbers: [] });
  const mode = publicUrl() ? "webhook" : "polling";
  try {
    const numbers = await listPhoneNumbers();
    return NextResponse.json({
      available: true,
      mode,
      connected: ctx.row.kapso_phone_number_id,
      numbers: numbers.map((n) => ({ id: n.phone_number_id, name: n.display_name, sandbox: n.kind === "sandbox", business_app: n.is_coexistence })),
    });
  } catch (err) {
    return NextResponse.json({ available: true, mode, connected: ctx.row.kapso_phone_number_id, numbers: [], error: err instanceof KapsoError ? err.message : String(err) });
  }
}

/** Connect this business to a Kapso number ({ id }), or disconnect ({ id: null }). */
export async function POST(req: Request) {
  const ctx = await currentBusiness();
  if (ctx instanceof NextResponse) return ctx;
  const { db, row } = ctx;
  const { id } = (await req.json()) as { id: string | null };
  if (id) {
    const numbers = await listPhoneNumbers().catch(() => []);
    if (!numbers.some((n) => n.phone_number_id === id)) return NextResponse.json({ error: "That number isn't in the Kapso project." }, { status: 400 });
    const [taken] = await db.query("SELECT 1 FROM businesses WHERE kapso_phone_number_id = $1 AND id <> $2", [id, row.id]);
    if (taken) return NextResponse.json({ error: "That number is already used by another business." }, { status: 409 });
  }

  // Remove the old webhook first (disconnecting, or switching numbers).
  if (row.kapso_webhook_id && row.kapso_phone_number_id) {
    await deleteWebhook(row.kapso_phone_number_id, row.kapso_webhook_id).catch((err) => console.error("Could not remove Kapso webhook:", err));
    await setWebhook(db, row.id, null);
  }
  await connectWhatsApp(db, row.id, id);

  const base = publicUrl();
  if (id && base) {
    const secret = randomBytes(24).toString("hex");
    try {
      const webhookId = await createWebhook(id, `${base}/api/kapso/webhook`, secret);
      await setWebhook(db, row.id, { id: webhookId, secret });
    } catch (err) {
      await connectWhatsApp(db, row.id, null);
      const msg = err instanceof KapsoError ? err.message : String(err);
      return NextResponse.json({ error: `Kapso didn't accept the webhook: ${msg}` }, { status: 502 });
    }
  }
  return NextResponse.json({ ok: true });
}
