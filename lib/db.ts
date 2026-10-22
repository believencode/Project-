import type { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";

/**
 * Server only. One small interface over two Postgres engines:
 * - DATABASE_URL set → a real Postgres server (production: Neon, Supabase, any host).
 * - not set → PGlite, Postgres compiled to WebAssembly running inside this process,
 *   stored in ./data/pg (nothing to install for development and tests).
 */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Run `fn` in one transaction; everything inside sees and writes the same state. */
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  /** Close connections (tests, shutdown). */
  close(): Promise<void>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
-- One business per owner for now. "data" holds the sheet and setup flags (everything but chats).
CREATE TABLE IF NOT EXISTS businesses (
  id text PRIMARY KEY,
  owner_id text NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  data jsonb NOT NULL,
  -- The Kapso number this business answers on (null: not connected).
  kapso_phone_number_id text UNIQUE,
  -- WhatsApp messages older than this are never answered (set when the number is connected).
  wa_connected_at timestamptz,
  wa_since timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- "state" is the chat without its messages: counts, pause, badges, draft, requests.
CREATE TABLE IF NOT EXISTS chats (
  business_id text NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  id text NOT NULL,
  wa_id text,
  state jsonb NOT NULL,
  last_at bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (business_id, id)
);
CREATE TABLE IF NOT EXISTS messages (
  business_id text NOT NULL,
  chat_id text NOT NULL,
  id text NOT NULL,
  at bigint NOT NULL,
  data jsonb NOT NULL,
  -- The WhatsApp message id, for messages that came from or went to WhatsApp.
  wa_message_id text UNIQUE,
  PRIMARY KEY (business_id, id),
  FOREIGN KEY (business_id, chat_id) REFERENCES chats(business_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS messages_by_chat ON messages (business_id, chat_id, at);
-- Added for webhooks (online hosting).
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS kapso_webhook_id text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS kapso_webhook_secret text;
`;

interface Querier {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

class PgliteDb implements Db {
  /** `root` is set outside a transaction; inside one, queries go through the transaction. */
  constructor(
    private readonly q: Querier,
    private readonly root?: PGlite,
  ) {}
  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.q.query<T>(sql, params)).rows;
  }
  async tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    if (!this.root) return fn(this);
    return this.root.transaction((t) => fn(new PgliteDb(t)));
  }
  async close(): Promise<void> {
    await this.root?.close();
  }
}

class PoolDb implements Db {
  constructor(private readonly pool: Pool) {}
  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.pool.query(sql, params)).rows as T[];
  }
  async tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const inTx: Db = {
      query: async <R,>(sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows as R[],
      tx: (inner) => inner(inTx),
      close: async () => undefined,
    };
    try {
      await client.query("BEGIN");
      const out = await fn(inTx);
      await client.query("COMMIT");
      return out;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
  async close(): Promise<void> {
    await this.pool.end();
  }
}

/** Open a database and make sure the tables exist. `memory` is for tests. */
export async function openDb(opts: { url?: string; dir?: string; memory?: boolean } = {}): Promise<Db> {
  if (opts.url) {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: opts.url });
    await pool.query(SCHEMA);
    return new PoolDb(pool);
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = opts.memory ? new PGlite() : new PGlite(opts.dir ?? "./data/pg");
  await pg.exec(SCHEMA);
  return new PgliteDb(pg, pg);
}

// One database per server process (kept across hot reloads in development).
const g = globalThis as unknown as { __kapsoDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  // Serverless hosts have no lasting disk: the built-in database would lose everything.
  if (process.env.VERCEL && !process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required online (Vercel). Add the Neon connection string in the project settings.");
  }
  g.__kapsoDb ??= openDb({ url: process.env.DATABASE_URL });
  return g.__kapsoDb;
}
