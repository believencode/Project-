import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { openDb, type Db } from "./db";
import { signUp } from "./auth";
import { connectWhatsApp, getBusinessRow, loadBusiness, loadChat, replaceBusiness, saveChat, setWebhook, updateBusinessData } from "./repo";
import { demoBusiness } from "./demo";
import { staffReply } from "./engine";

/**
 * The production path: a real Postgres server reached through the `pg` client
 * (as with Neon), here served locally so the test needs nothing installed.
 */
let server: PGLiteSocketServer;
let db: Db;
const PORT = 55432;

beforeAll(async () => {
  const pg = await PGlite.create();
  server = new PGLiteSocketServer({ db: pg, port: PORT, host: "127.0.0.1" });
  await server.start();
  db = await openDb({ url: `postgres://postgres:postgres@127.0.0.1:${PORT}/postgres?sslmode=disable` });
});

afterAll(async () => {
  await db.close();
  await server.stop();
});

describe("Postgres through the pg client", () => {
  it("runs the whole data flow", async () => {
    const owner = await signUp(db, "owner@shop.kg", "secret123");
    const row = await replaceBusiness(db, owner, demoBusiness("shop"));
    await updateBusinessData(db, row.id, { live: true });
    await connectWhatsApp(db, row.id, "597907523413541");
    await setWebhook(db, row.id, { id: "wh_1", secret: "s" });

    const fresh = (await getBusinessRow(db, owner))!;
    expect(fresh.kapso_webhook_id).toBe("wh_1");
    // Timestamps come back as Date objects from pg; the app must read them either way.
    expect(new Date(fresh.wa_connected_at!).getTime()).toBeGreaterThan(Date.now() - 60_000);

    const b = await loadBusiness(db, fresh);
    expect(b.live).toBe(true);
    expect(b.chats.length).toBeGreaterThan(1);
    expect(b.sheet.prices[0].item).toBe("Белые кроссовки");

    const chat = (await loadChat(db, row.id, "test"))!;
    const after = staffReply(chat, "Здравствуйте", 1000, "inbox");
    await saveChat(db, row.id, after, { waId: "996555", waIds: { [after.messages[0].id]: "wamid.1" } });
    expect((await loadChat(db, row.id, "test"))!.messages.map((m) => m.text)).toEqual(["Здравствуйте", after.messages[1].text]);
  });
});
