import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { SESSION_COOKIE, userForSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Who is logged in: { email } or { email: null }. */
export async function GET() {
  const user = await userForSession(await getDb(), (await cookies()).get(SESSION_COOKIE)?.value);
  return NextResponse.json({ email: user?.email ?? null });
}
