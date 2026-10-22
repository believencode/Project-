import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDb, type Db } from "./db";
import { SESSION_COOKIE, userForSession } from "./auth";
import { getBusinessRow, type BusinessRow } from "./repo";

/** Server only. The logged-in owner for an API request, or a 401 response. */
export async function currentOwner(): Promise<{ db: Db; user: { id: string; email: string } } | NextResponse> {
  const db = await getDb();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const user = await userForSession(db, token);
  if (!user) return NextResponse.json({ error: "Log in first." }, { status: 401 });
  return { db, user };
}

/** The owner and their business, or a 401/404 response. */
export async function currentBusiness(): Promise<{ db: Db; user: { id: string; email: string }; row: BusinessRow } | NextResponse> {
  const owner = await currentOwner();
  if (owner instanceof NextResponse) return owner;
  const row = await getBusinessRow(owner.db, owner.user.id);
  if (!row) return NextResponse.json({ error: "No business yet." }, { status: 404 });
  return { ...owner, row };
}

export function sessionCookie(token: string, expires: Date) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  };
}
