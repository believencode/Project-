import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { databaseUnavailable } from "@/lib/health";
import { AuthError, createSession, logIn } from "@/lib/auth";
import { sessionCookie } from "@/lib/session";

export async function POST(req: Request) {
  const { email, password } = (await req.json()) as { email?: string; password?: string };
  const db = await getDb().catch(() => null);
  if (!db) return databaseUnavailable();
  try {
    const userId = await logIn(db, email ?? "", password ?? "");
    const { token, expires } = await createSession(db, userId);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(sessionCookie(token, expires));
    return res;
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }
}
