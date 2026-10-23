import { randomBytes } from "node:crypto";
import type { Db } from "../db";
import { connectWhatsApp, setKapsoCustomer, setWebhook, type BusinessRow } from "../repo";
import { KapsoError, createSetupLink, createWebhook, deleteWebhook, ensureCustomer, listPhoneNumbers, type KapsoPhoneNumber } from "../kapso";
import { publicUrl } from "../url";

/**
 * Server only. Connecting a business to its WhatsApp number.
 *
 * Owners connect their own WhatsApp Business app number through a Kapso setup
 * link: one Kapso customer per business, so each owner only ever sees and
 * connects the numbers connected for them (plus the shared test number).
 */

export interface NumberView {
  id: string;
  name: string | null;
  phone: string | null;
  sandbox: boolean;
  business_app: boolean;
}

export const view = (n: KapsoPhoneNumber): NumberView => ({
  id: n.phone_number_id,
  name: n.display_name,
  phone: n.display_phone_number ?? null,
  sandbox: n.kind === "sandbox",
  business_app: n.is_coexistence,
});

/** The numbers this business may connect: its own, and the shared test number. Never another business's. */
export function visibleNumbers(numbers: KapsoPhoneNumber[], customerId: string | null | undefined): KapsoPhoneNumber[] {
  return numbers.filter((n) => n.kind === "sandbox" || (customerId != null && n.customer_id === customerId));
}

/** The number the owner just connected: the one named by the redirect, or else their newest. */
export function pickNumber(numbers: KapsoPhoneNumber[], customerId: string, phoneNumberId?: string): KapsoPhoneNumber | undefined {
  const own = numbers.filter((n) => n.customer_id === customerId && n.kind !== "sandbox");
  return phoneNumberId ? own.find((n) => n.phone_number_id === phoneNumberId) : own[0];
}

/** Who pays Meta's message fees for numbers connected through our links (see README). */
function billing(): "customer_managed" | "partner_managed" {
  return process.env.KAPSO_META_BILLING === "partner_managed" ? "partner_managed" : "customer_managed";
}

/** A fresh setup link for this business. `origin` is used when the app has no public address (local). */
export async function startSetup(db: Db, row: BusinessRow, origin: string): Promise<string> {
  let customerId = row.kapso_customer_id;
  if (!customerId) {
    customerId = await ensureCustomer(row.id, row.data.sheet.name);
    await setKapsoCustomer(db, row.id, customerId);
  }
  const base = publicUrl() ?? origin;
  const link = await createSetupLink(customerId, {
    successUrl: `${base}/connect/done`,
    failureUrl: `${base}/connect/failed`,
    billing: billing(),
  });
  return link.url;
}

export type ConnectResult = { ok: true } | { ok: false; status: number; error: string };

/**
 * Point this business at a number (or none). Online, Kapso then pushes the number's
 * messages to our webhook; the old webhook is removed first.
 */
export async function connectNumber(db: Db, row: BusinessRow, id: string | null): Promise<ConnectResult> {
  if (id) {
    const [taken] = await db.query("SELECT 1 FROM businesses WHERE kapso_phone_number_id = $1 AND id <> $2", [id, row.id]);
    if (taken) return { ok: false, status: 409, error: "That number is already used by another business." };
  }
  if (row.kapso_webhook_id && row.kapso_phone_number_id) {
    await deleteWebhook(row.kapso_phone_number_id, row.kapso_webhook_id).catch((err) => console.error("Could not remove Kapso webhook:", err));
    await setWebhook(db, row.id, null);
  }
  await connectWhatsApp(db, row.id, id);

  const base = publicUrl();
  if (id && base) {
    const secret = randomBytes(24).toString("hex");
    try {
      const webhookId = await createWebhook(id, `${base}/api/kapso/webhook`, secret);
      await setWebhook(db, row.id, { id: webhookId, secret });
    } catch (err) {
      await connectWhatsApp(db, row.id, null);
      console.error("Kapso didn't accept the webhook:", err instanceof KapsoError ? err.message : err);
      return { ok: false, status: 502, error: "Couldn't connect the number. Try again." };
    }
  }
  return { ok: true };
}

/**
 * After the owner finished on the setup page: find their new number and connect it.
 * Kapso may still be finishing on its side, so "pending" means: ask again shortly.
 */
export async function completeSetup(
  db: Db,
  row: BusinessRow,
  phoneNumberId?: string,
): Promise<{ status: "connected"; number: NumberView } | { status: "pending" } | { status: "error"; code: number; error: string }> {
  if (!row.kapso_customer_id) return { status: "pending" };
  const numbers = await listPhoneNumbers({ customer_id: row.kapso_customer_id });
  const n = pickNumber(numbers, row.kapso_customer_id, phoneNumberId);
  if (!n) return { status: "pending" };
  if (row.kapso_phone_number_id !== n.phone_number_id) {
    const r = await connectNumber(db, row, n.phone_number_id);
    if (!r.ok) return { status: "error", code: r.status, error: r.error };
  }
  return { status: "connected", number: view(n) };
}
