import { getDb, type Db } from "../db";
import { businessesOnWhatsApp, getBusinessRowById, setWaSince, type BusinessRow } from "../repo";
import { KapsoError, kapsoEnabled, listMessages } from "../kapso";
import { handleInbound, handleStaffEcho, isLive } from "./inbound";

/**
 * Server only, local development. Every few seconds, asks Kapso for new WhatsApp
 * messages for each connected business that has no webhook. Online, Kapso
 * sends messages to /api/kapso/webhook instead.
 */

const POLL_MS = 3000;
async function pollBusiness(db: Db, row: BusinessRow) {
  const phone = row.kapso_phone_number_id!;
  const since = new Date(row.wa_since ?? row.wa_connected_at ?? Date.now());
  const [inbound, outbound] = await Promise.all([
    listMessages(phone, { since, direction: "inbound" }),
    listMessages(phone, { since, direction: "outbound" }),
  ]);
  const fresh = [...inbound, ...outbound.filter((m) => m.kapso?.origin === "business_app")]
    .filter((m) => isLive(row, m))
    .sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
  for (const m of fresh) {
    try {
      if (m.kapso?.direction === "outbound") await handleStaffEcho(db, row, m);
      else await handleInbound(db, row, m);
    } catch (err) {
      console.error(`WhatsApp message ${m.id} failed:`, err);
    }
  }
  const newest = [...inbound, ...outbound].reduce((t, m) => Math.max(t, Number(m.timestamp) * 1000), since.getTime());
  // A 60s overlap: Kapso may list a message a moment after its timestamp; duplicates are skipped.
  await setWaSince(db, row.id, new Date(Math.max(since.getTime(), newest - 60_000)));
}

async function pollAll() {
  const db = await getDb();
  // Businesses with a webhook get their messages pushed by Kapso.
  for (const r of (await businessesOnWhatsApp(db)).filter((b) => !b.kapso_webhook_id)) {
    // Re-read so sheet changes made in the web app apply immediately.
    const row = await getBusinessRowById(db, r.id);
    if (!row?.kapso_phone_number_id) continue;
    try {
      await pollBusiness(db, row);
    } catch (err) {
      console.error(`WhatsApp poll for ${row.id} failed:`, err instanceof KapsoError ? err.message : err);
    }
  }
}

const g = globalThis as unknown as { __waPoller?: boolean };

export function startWhatsAppPoller() {
  // Serverless hosting (Vercel) can't run a background loop; it uses webhooks only.
  if (g.__waPoller || !kapsoEnabled() || process.env.VERCEL || process.env.KAPSO_POLL === "0") return;
  g.__waPoller = true;
  console.log("WhatsApp: checking Kapso for new messages every 3s");
  const tick = async () => {
    await pollAll().catch((err) => console.error("WhatsApp poll failed:", err));
    setTimeout(tick, POLL_MS);
  };
  void tick();
}
