import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "./db";
import { AuthError, createSession, logIn, signUp, userForSession } from "./auth";
import {
  businessesOnWhatsApp,
  connectWhatsApp,
  deleteImportedChats,
  getBusinessRow,
  loadBusiness,
  loadChat,
  replaceBusiness,
  saveChat,
  seenWaMessage,
  updateBusinessData,
} from "./repo";
import { demoBusiness } from "./demo";
import { staffReply } from "./engine";

let db: Db;
beforeEach(async () => {
  db = await openDb({ memory: true });
});

describe("accounts", () => {
  it("signs up, logs in, and keeps a session", async () => {
    const id = await signUp(db, "Owner@Shop.kg ", "secret123");
    expect(await logIn(db, "owner@shop.kg", "secret123")).toBe(id);
    await expect(logIn(db, "owner@shop.kg", "wrong-pass")).rejects.toBeInstanceOf(AuthError);
    await expect(signUp(db, "owner@shop.kg", "another123")).rejects.toThrow(/already exists/);
    await expect(signUp(db, "bad-email", "secret123")).rejects.toThrow(/valid email/);
    const { token } = await createSession(db, id);
    expect(await userForSession(db, token)).toEqual({ id, email: "owner@shop.kg" });
    expect(await userForSession(db, "nope")).toBeNull();
  });
});

describe("businesses and chats", () => {
  it("saves and loads a business with its chats and messages", async () => {
    const owner = await signUp(db, "a@b.kg", "secret123");
    const demo = demoBusiness("shop");
    await replaceBusiness(db, owner, demo);
    const row = (await getBusinessRow(db, owner))!;
    const loaded = await loadBusiness(db, row);
    expect(loaded.sheet.name).toBe("Обувь 10");
    expect(loaded.chats).toHaveLength(demo.chats.length);
    const aigerim = loaded.chats.find((c) => c.customer === "Айгерим")!;
    expect(aigerim.messages.map((m) => m.text)).toEqual(demo.chats.find((c) => c.customer === "Айгерим")!.messages.map((m) => m.text));

    await updateBusinessData(db, row.id, { live: true, sheet: { ...loaded.sheet, hours: "09:00–21:00" } });
    const again = await loadBusiness(db, (await getBusinessRow(db, owner))!);
    expect(again.live).toBe(true);
    expect(again.sheet.hours).toBe("09:00–21:00");
    expect(again.chats).toHaveLength(demo.chats.length);
  });

  it("saves a chat turn and links WhatsApp ids", async () => {
    const owner = await signUp(db, "a@b.kg", "secret123");
    const row = await replaceBusiness(db, owner, demoBusiness("shop"));
    const chat = (await loadChat(db, row.id, "test"))!;
    const after = staffReply(chat, "Здравствуйте", 1000, "inbox");
    await saveChat(db, row.id, after, { waId: "996555", waIds: { [after.messages[0].id]: "wamid.1" } });
    const loaded = (await loadChat(db, row.id, "test"))!;
    expect(loaded.paused_until).toBe(after.paused_until);
    expect(loaded.messages.map((m) => m.from)).toEqual(["staff", "system"]);
    expect(await seenWaMessage(db, "wamid.1")).toBe(true);
    expect(await seenWaMessage(db, "wamid.2")).toBe(false);
  });

  it("deleting imported chats keeps the test chat", async () => {
    const owner = await signUp(db, "a@b.kg", "secret123");
    const row = await replaceBusiness(db, owner, demoBusiness("shop"));
    await deleteImportedChats(db, row.id);
    const b = await loadBusiness(db, (await getBusinessRow(db, owner))!);
    expect(b.chats.map((c) => c.id)).toEqual(["test"]);
    expect(b.imported_history).toBe(false);
  });

  it("one owner's data is never visible to another", async () => {
    const a = await signUp(db, "a@b.kg", "secret123");
    const b = await signUp(db, "c@d.kg", "secret123");
    await replaceBusiness(db, a, demoBusiness("shop"));
    expect(await getBusinessRow(db, b)).toBeNull();
  });

  it("connects a WhatsApp number", async () => {
    const owner = await signUp(db, "a@b.kg", "secret123");
    const row = await replaceBusiness(db, owner, demoBusiness("shop"));
    await connectWhatsApp(db, row.id, "597907523413541");
    const [onWa] = await businessesOnWhatsApp(db);
    expect(onWa.kapso_phone_number_id).toBe("597907523413541");
    expect(onWa.wa_connected_at).not.toBeNull();
  });
});
