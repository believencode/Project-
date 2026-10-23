import { NextResponse } from "next/server";
import type { AlertSettings } from "@/lib/types";
import { currentBusiness } from "@/lib/session";
import { updateBusinessData } from "@/lib/repo";
import { normalizePhone, sendAlert } from "@/lib/alerts";
import { DEFAULT_LANG, isLang, translate } from "@/lib/i18n";

export const dynamic = "force-dynamic";

/** The owner's alert settings, and whether an approved template is set up on this server. */
export async function GET() {
  const ctx = await currentBusiness();
  if (ctx instanceof NextResponse) return ctx;
  return NextResponse.json({ alerts: ctx.row.data.alerts ?? null, template: Boolean(process.env.ALERT_TEMPLATE) });
}

/** Save the owner's number and on/off. */
export async function PUT(req: Request) {
  const ctx = await currentBusiness();
  if (ctx instanceof NextResponse) return ctx;
  const body = (await req.json()) as { phone?: string; enabled?: boolean; lang?: string };
  const phone = normalizePhone(body.phone ?? "");
  if (!phone) return NextResponse.json({ error: "Enter the number with the country code, e.g. +996 555 123 456." }, { status: 400 });
  const alerts: AlertSettings = { phone, enabled: body.enabled !== false, lang: isLang(body.lang) ? body.lang : DEFAULT_LANG };
  await updateBusinessData(ctx.db, ctx.row.id, { alerts });
  return NextResponse.json({ alerts });
}

/** Send a test alert to the saved number. */
export async function POST() {
  const ctx = await currentBusiness();
  if (ctx instanceof NextResponse) return ctx;
  const settings = ctx.row.data.alerts;
  if (!settings?.phone) return NextResponse.json({ error: "Enter the number with the country code, e.g. +996 555 123 456." }, { status: 400 });
  if (!process.env.ALERT_PHONE_NUMBER_ID && !ctx.row.kapso_phone_number_id) {
    return NextResponse.json({ error: "Connect a WhatsApp number first (Settings → WhatsApp)." }, { status: 400 });
  }
  const text = translate(settings.lang, "alert_test_msg");
  const result = await sendAlert(ctx.row, { ...settings, enabled: true }, { text, params: ["Jardamchy", text, "—"] });
  if (result !== "sent") {
    return NextResponse.json({ error: "WhatsApp didn't deliver the alert. Without an approved template, that number must have written to the business number in the last 24 hours." }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
