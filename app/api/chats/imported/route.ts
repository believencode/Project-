import { NextResponse } from "next/server";
import { currentBusiness } from "@/lib/session";
import { deleteImportedChats } from "@/lib/repo";

/** Settings → Delete imported chats. The approved sheet and the test chat stay. */
export async function DELETE() {
  const ctx = await currentBusiness();
  if (ctx instanceof NextResponse) return ctx;
  await deleteImportedChats(ctx.db, ctx.row.id);
  return NextResponse.json({ ok: true });
}
