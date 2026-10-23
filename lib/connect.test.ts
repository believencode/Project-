import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb, type Db } from "./db";
import { signUp } from "./auth";
import { getBusinessRow, replaceBusiness, type BusinessRow } from "./repo";
import { demoBusiness } from "./demo";
import type { KapsoPhoneNumber } from "./kapso";

// A fake Kapso: numbers in the project, customers and setup links it hands out.
let numbers: KapsoPhoneNumber[] = [];
const links: { customerId: string; successUrl: string; failureUrl: string; billing: string }[] = [];
const customers = new Map<string, string>();
vi.mock("./kapso", () => ({
  KapsoError: class extends Error {},
  listPhoneNumbers: vi.fn(async (f: { customer_id?: string } = {}) => numbers.filter((n) => !f.customer_id || n.customer_id === f.customer_id)),
  ensureCustomer: vi.fn(async (externalId: string) => {
    if (!customers.has(externalId)) customers.set(externalId, `cus-${customers.size + 1}`);
    return customers.get(externalId)!;
  }),
  createSetupLink: vi.fn(async (customerId: string, o: { successUrl: string; failureUrl: string; billing: string }) => {
    links.push({ customerId, ...o });
    return { id: `link-${links.length}`, url: `https://setup.kapso.ai/s/${links.length}` };
  }),
  createWebhook: vi.fn(async () => "wh-1"),
  deleteWebhook: vi.fn(async () => undefined),
}));
const { visibleNumbers, pickNumber, startSetup, completeSetup } = await import("./whatsapp/connect");
const { failureReason } = await import("./whatsapp/failure");

const num = (id: string, customer_id: string | null, extra: Partial<KapsoPhoneNumber> = {}): KapsoPhoneNumber => ({
  phone_number_id: id,
  display_name: `Name ${id}`,
  display_phone_number: `+996 555 00${id}`,
  kind: "production",
  is_coexistence: true,
  customer_id,
  ...extra,
});

let db: Db;
let row: BusinessRow;
beforeEach(async () => {
  numbers = [];
  links.length = 0;
  customers.clear();
  vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "jardamchy.vercel.app");
  db = await openDb({ memory: true });
  const owner = await signUp(db, "owner@cafe.kg", "secret123");
  row = await replaceBusiness(db, owner, demoBusiness("cafe", "Кафе Ала-Тоо"));
});
afterEach(() => vi.unstubAllEnvs());

describe("which numbers a business sees", () => {
  it("its own and the shared test number, never another business's", () => {
    const all = [num("1", "cus-1"), num("2", "cus-2"), num("3", null, { kind: "sandbox" }), num("4", null)];
    expect(visibleNumbers(all, "cus-1").map((n) => n.phone_number_id)).toEqual(["1", "3"]);
    expect(visibleNumbers(all, null).map((n) => n.phone_number_id)).toEqual(["3"]);
  });

  it("picks the number from the redirect, or the business's newest", () => {
    const all = [num("9", "cus-1"), num("8", "cus-1"), num("7", "cus-2")];
    expect(pickNumber(all, "cus-1", "8")?.phone_number_id).toBe("8");
    expect(pickNumber(all, "cus-1")?.phone_number_id).toBe("9");
    // A number id from someone else's redirect is never accepted.
    expect(pickNumber(all, "cus-1", "7")).toBeUndefined();
  });
});

describe("connecting through a setup link", () => {
  it("creates one Kapso customer per business and a link back to the app", async () => {
    const url = await startSetup(db, row, "http://localhost:3000");
    expect(url).toBe("https://setup.kapso.ai/s/1");
    expect(links[0]).toEqual({
      customerId: "cus-1",
      successUrl: "https://jardamchy.vercel.app/connect/done",
      failureUrl: "https://jardamchy.vercel.app/connect/failed",
      billing: "customer_managed",
    });
    row = (await getBusinessRow(db, row.owner_id))!;
    expect(row.kapso_customer_id).toBe("cus-1");
    // A second try reuses the same customer.
    await startSetup(db, row, "http://localhost:3000");
    expect(links[1].customerId).toBe("cus-1");
    expect(customers.size).toBe(1);
  });

  it("uses the request's address when the app has no public one (local)", async () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    await startSetup(db, row, "http://localhost:3300");
    expect(links[0].successUrl).toBe("http://localhost:3300/connect/done");
  });

  it("is pending until Kapso lists the number, then connects it", async () => {
    await startSetup(db, row, "x");
    row = (await getBusinessRow(db, row.owner_id))!;
    expect(await completeSetup(db, row, "555")).toEqual({ status: "pending" });

    numbers = [num("555", "cus-1")];
    const r = await completeSetup(db, row, "555");
    expect(r).toMatchObject({ status: "connected", number: { id: "555", phone: "+996 555 00555" } });
    row = (await getBusinessRow(db, row.owner_id))!;
    expect(row.kapso_phone_number_id).toBe("555");
    expect(row.kapso_webhook_id).toBe("wh-1");
  });

  it("finds the new number without the redirect (owner came back another way)", async () => {
    await startSetup(db, row, "x");
    row = (await getBusinessRow(db, row.owner_id))!;
    numbers = [num("777", "cus-1")];
    expect(await completeSetup(db, row)).toMatchObject({ status: "connected", number: { id: "777" } });
  });

  it("never connects a number that belongs to another business", async () => {
    await startSetup(db, row, "x");
    row = (await getBusinessRow(db, row.owner_id))!;
    numbers = [num("888", "cus-someone-else")];
    expect(await completeSetup(db, row, "888")).toEqual({ status: "pending" });
    row = (await getBusinessRow(db, row.owner_id))!;
    expect(row.kapso_phone_number_id).toBeNull();
  });

  it("explains Kapso's failure codes in plain words", () => {
    expect(failureReason("link_expired")).toBe("fail_expired");
    expect(failureReason("facebook_auth_failed")).toBe("fail_auth");
    expect(failureReason("something_new")).toBe("fail_unknown");
    expect(failureReason(null)).toBe("fail_unknown");
  });
});
