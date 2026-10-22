import { createHmac, timingSafeEqual } from "node:crypto";
import type { Db } from "../db";
import type { KapsoMessage } from "../kapso";
import { businessForNumber, getBusinessRowById } from "../repo";
import { handleInbound, handleStaffEcho, isLive } from "./inbound";

/**
 * Server only. Kapso webhooks: check the signature, then hand each message to
 * the same handlers polling uses. Docs: https://docs.kapso.ai/docs/platform/webhooks/security
 */

export function signatureValid(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(rawBody).digest("hex"), "utf8");
  const given = Buffer.from(signature, "utf8");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

interface MessageEvent {
  message: KapsoMessage;
  conversation?: { contact_name?: string; phone_number?: string };
  phone_number_id?: string;
}

/** One delivery may be a single event or a batch (`{ batch: true, data: [...] }`). */
function eventsIn(body: unknown): MessageEvent[] {
  const b = body as { batch?: boolean; data?: MessageEvent[] } & MessageEvent;
  return b.batch && Array.isArray(b.data) ? b.data : [b];
}

export type WebhookResult =
  | { status: 200; work: (() => Promise<void>) | null }
  | { status: 400 | 401 | 404; error: string };

/**
 * Check a delivery and return the work to do. The caller answers Kapso right
 * away (it wants a reply within 10 seconds) and runs `work` afterwards.
 */
export async function receiveWebhook(db: Db, rawBody: string, signature: string | null, eventName: string | null): Promise<WebhookResult> {
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { status: 400, error: "not JSON" };
  }
  const events = eventsIn(body);
  const phoneNumberId = events[0]?.phone_number_id;
  if (!phoneNumberId) return { status: 400, error: "no phone_number_id" };
  const row = await businessForNumber(db, phoneNumberId);
  if (!row?.kapso_webhook_secret) return { status: 404, error: "number not connected" };
  if (!signatureValid(rawBody, signature, row.kapso_webhook_secret)) return { status: 401, error: "bad signature" };

  const work = async () => {
    for (const e of events) {
      const m = e.message;
      if (!m?.id) continue;
      // Re-read: the sheet or connection may have changed since the delivery arrived.
      const current = await getBusinessRowById(db, row.id);
      if (!current?.kapso_phone_number_id || !isLive(current, m)) continue;
      const contact = { ...m, kapso: { ...m.kapso, contact_name: m.kapso?.contact_name ?? e.conversation?.contact_name } };
      try {
        if (eventName === "whatsapp.message.received" || m.kapso?.direction === "inbound") await handleInbound(db, current, contact);
        else if (m.kapso?.origin === "business_app") await handleStaffEcho(db, current, contact);
      } catch (err) {
        console.error(`WhatsApp webhook message ${m.id} failed:`, err);
      }
    }
  };
  return { status: 200, work };
}
