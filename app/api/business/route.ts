import { NextResponse } from "next/server";
import type { Business } from "@/lib/types";
import { currentBusiness, currentOwner } from "@/lib/session";
import { deleteBusiness, getBusinessRow, loadBusiness, replaceBusiness, updateBusinessData } from "@/lib/repo";

export const dynamic = "force-dynamic";

/** The owner's business with all chats; `whatsapp` is the connected number, if any. */
export async function GET() {
  const ctx = await currentOwner();
  if (ctx instanceof NextResponse) return ctx;
  const row = await getBusinessRow(ctx.db, ctx.user.id);
  if (!row) return NextResponse.json({ business: null, whatsapp: null });
  return NextResponse.json({ business: await loadBusiness(ctx.db, row), whatsapp: row.kapso_phone_number_id });
}

/** Create or replace the business (end of setup, or the demo shop). */
export async function PUT(req: Request) {
  const ctx = await currentOwner();
  if (ctx instanceof NextResponse) return ctx;
  const b = (await req.json()) as Business;
  if (!b?.sheet || !Array.isArray(b.chats)) return NextResponse.json({ error: "business with sheet and chats required" }, { status: 400 });
  const row = await replaceBusiness(ctx.db, ctx.user.id, b);
  return NextResponse.json({ business: await loadBusiness(ctx.db, row), whatsapp: row.kapso_phone_number_id });
}

/** Change the sheet or setup flags (chats are changed through /api/chats). */
export async function PATCH(req: Request) {
  const ctx = await currentBusiness();
  if (ctx instanceof NextResponse) return ctx;
  const patch = (await req.json()) as Partial<Business>;
  const allowed: (keyof Business)[] = ["sheet", "live", "imported_history", "sheet_built_by", "backup"];
  const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k as keyof Business)));
  await updateBusinessData(ctx.db, ctx.row.id, clean);
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const ctx = await currentOwner();
  if (ctx instanceof NextResponse) return ctx;
  await deleteBusiness(ctx.db, ctx.user.id);
  return NextResponse.json({ ok: true });
}
