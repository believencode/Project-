import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { AuthError, createSession, signUp } from "@/lib/auth";
import { sessionCookie } from "@/lib/session";

export async function POST(req: Request) {
  const { email, password } = (await req.json()) as { email?: string; password?: string };
  const db = await getDb();
  try {
    const userId = await signUp(db, email ?? "", password ?? "");
    const { token, expires } = await createSession(db, userId);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(sessionCookie(token, expires));
    return res;
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
