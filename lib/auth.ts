import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Db } from "./db";

/** Server only. Owner accounts: email + password, sessions in a cookie. */

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export const SESSION_COOKIE = "kd_session";
const SESSION_DAYS = 30;

export class AuthError extends Error {}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scrypt(password, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();

export async function signUp(db: Db, email: string, password: string): Promise<string> {
  const e = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new AuthError("Enter a valid email.");
  if (password.length < 8) throw new AuthError("Password must be at least 8 characters.");
  const [taken] = await db.query("SELECT 1 FROM users WHERE email = $1", [e]);
  if (taken) throw new AuthError("An account with this email already exists. Log in instead.");
  const id = `u_${randomBytes(8).toString("hex")}`;
  await db.query("INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)", [id, e, await hashPassword(password)]);
  return id;
}

export async function logIn(db: Db, email: string, password: string): Promise<string> {
  const [user] = await db.query<{ id: string; password_hash: string }>("SELECT id, password_hash FROM users WHERE email = $1", [
    normalizeEmail(email),
  ]);
  if (!user || !(await checkPassword(password, user.password_hash))) throw new AuthError("Wrong email or password.");
  return user.id;
}

export async function createSession(db: Db, userId: string): Promise<{ token: string; expires: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60_000);
  await db.query("INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)", [token, userId, expires.toISOString()]);
  return { token, expires };
}

export async function userForSession(db: Db, token: string | undefined): Promise<{ id: string; email: string } | null> {
  if (!token) return null;
  const [row] = await db.query<{ id: string; email: string }>(
    "SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1 AND s.expires_at > now()",
    [token],
  );
  return row ?? null;
}

export async function endSession(db: Db, token: string | undefined): Promise<void> {
  if (token) await db.query("DELETE FROM sessions WHERE token = $1", [token]);
}
