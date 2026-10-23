/**
 * Server only. Everything that talks to Kapso lives here, so switching to
 * Meta's API or another provider later means replacing this one file.
 * Docs: https://docs.kapso.ai/api/introduction
 */

const WHATSAPP_API = "https://api.kapso.ai/meta/whatsapp/v24.0";
const PLATFORM_API = "https://api.kapso.ai/platform/v1";

export interface KapsoMessage {
  id: string;
  /** Seconds since epoch, as a string. */
  timestamp: string;
  type: string;
  from?: string;
  to?: string;
  text?: { body: string };
  kapso?: {
    direction?: "inbound" | "outbound";
    /**
     * "business_app" when staff replied from the WhatsApp Business app on the phone,
     * "history_sync" for chats the owner shared when connecting the number.
     */
    origin?: string;
    contact_name?: string;
    phone_number?: string;
  };
}

export interface KapsoPhoneNumber {
  phone_number_id: string;
  display_name: string | null;
  /** "+996 555 123 456" as Meta shows it. */
  display_phone_number?: string | null;
  kind: string;
  is_coexistence: boolean;
  /** The Kapso customer (one per business) the number was connected for. */
  customer_id?: string | null;
}

export class KapsoError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * WhatsApp is on when KAPSO_API_KEY is set, or KAPSO_ENABLED=1 when the key is a
 * network secret that the cloud environment adds to requests for api.kapso.ai.
 */
export function kapsoEnabled(): boolean {
  return Boolean(process.env.KAPSO_API_KEY) || process.env.KAPSO_ENABLED === "1";
}

function authHeaders(): Record<string, string> {
  if (!kapsoEnabled()) throw new KapsoError("Kapso isn't set up (KAPSO_API_KEY or KAPSO_ENABLED=1)", 0);
  return process.env.KAPSO_API_KEY ? { "X-API-Key": process.env.KAPSO_API_KEY } : {};
}

async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  const request = () =>
    fetch(url, {
      ...init,
      headers: { ...authHeaders(), "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
  let res: Response;
  try {
    res = await request();
  } catch {
    // A dropped connection: try once more. Reads are safe to repeat; a send that never got a
    // response is retried too, since not sending is worse than a rare duplicate.
    await new Promise((r) => setTimeout(r, 500));
    res = await request();
  }
  const body = await res.text();
  if (!res.ok) throw new KapsoError(`Kapso ${res.status}: ${body.slice(0, 300)}`, res.status);
  return JSON.parse(body) as T;
}

export async function listPhoneNumbers(filter: { customer_id?: string; phone_number_id?: string } = {}): Promise<KapsoPhoneNumber[]> {
  const q = new URLSearchParams(Object.entries(filter).filter(([, v]) => v) as [string, string][]);
  const { data } = await call<{ data: KapsoPhoneNumber[] }>(`${PLATFORM_API}/whatsapp/phone_numbers${q.size ? `?${q}` : ""}`);
  return data;
}

/** The Kapso customer for one of our businesses, created on first use. */
export async function ensureCustomer(externalId: string, name: string): Promise<string> {
  const q = new URLSearchParams({ external_customer_id: externalId });
  const { data } = await call<{ data: { id: string }[] }>(`${PLATFORM_API}/customers?${q}`);
  if (data[0]) return data[0].id;
  const created = await call<{ data: { id: string } }>(`${PLATFORM_API}/customers`, {
    method: "POST",
    body: JSON.stringify({ customer: { name, external_customer_id: externalId } }),
  });
  return created.data.id;
}

export interface SetupLinkOptions {
  successUrl: string;
  failureUrl: string;
  billing: "customer_managed" | "partner_managed";
}

/**
 * A link where the owner connects their WhatsApp Business app number (coexistence only,
 * so the choice is made for them). Valid for 30 days, usable once.
 */
export async function createSetupLink(customerId: string, o: SetupLinkOptions): Promise<{ id: string; url: string }> {
  const { data } = await call<{ data: { id: string; url: string } }>(`${PLATFORM_API}/customers/${customerId}/setup_links`, {
    method: "POST",
    body: JSON.stringify({
      setup_link: {
        success_redirect_url: o.successUrl,
        failure_redirect_url: o.failureUrl,
        allowed_connection_types: ["coexistence"],
        meta_billing_mode: o.billing,
        // Jardamchy's colours, so the page feels like part of the app.
        theme_config: {
          primary_color: "#127a52",
          background_color: "#f4f5f2",
          text_color: "#1b1f1d",
          muted_text_color: "#66706b",
          card_color: "#ffffff",
          border_color: "#e2e5e0",
        },
      },
    }),
  });
  return { id: data.id, url: data.url };
}

/** Messages created on or after `since`, oldest first (follows pagination). */
export async function listMessages(
  phoneNumberId: string,
  opts: { since: Date; direction?: "inbound" | "outbound"; maxPages?: number },
): Promise<KapsoMessage[]> {
  const out: KapsoMessage[] = [];
  let after: string | null = null;
  for (let page = 0; page < (opts.maxPages ?? 10); page++) {
    const q = new URLSearchParams({ since: opts.since.toISOString(), limit: "100", fields: "kapso(default,origin)" });
    if (opts.direction) q.set("direction", opts.direction);
    if (after) q.set("after", after);
    const res: { data: KapsoMessage[]; paging?: { cursors?: { after?: string | null }; next?: string | null } } = await call(
      `${WHATSAPP_API}/${phoneNumberId}/messages?${q}`,
    );
    out.push(...res.data);
    after = res.paging?.next ? (res.paging.cursors?.after ?? null) : null;
    if (!after) break;
  }
  return out.sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
}

export async function sendText(phoneNumberId: string, to: string, body: string): Promise<string | undefined> {
  const res = await call<{ messages?: { id: string }[] }>(`${WHATSAPP_API}/${phoneNumberId}/messages`, {
    method: "POST",
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
  });
  return res.messages?.[0]?.id;
}

/**
 * A Meta-approved template message: the only kind WhatsApp delivers to someone who hasn't
 * written to this number in the last 24 hours. `params` fill {{1}}, {{2}}… in the body.
 */
export async function sendTemplate(phoneNumberId: string, to: string, name: string, language: string, params: string[]): Promise<string | undefined> {
  const res = await call<{ messages?: { id: string }[] }>(`${WHATSAPP_API}/${phoneNumberId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name,
        language: { code: language },
        components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }],
      },
    }),
  });
  return res.messages?.[0]?.id;
}

const WEBHOOK_EVENTS = ["whatsapp.message.received", "whatsapp.message.sent"];

/** Ask Kapso to push this number's messages to `url`, signed with `secret`. Returns the webhook id. */
export async function createWebhook(phoneNumberId: string, url: string, secret: string): Promise<string> {
  const res = await call<{ data: { id: string } }>(`${PLATFORM_API}/whatsapp/phone_numbers/${phoneNumberId}/webhooks`, {
    method: "POST",
    body: JSON.stringify({ whatsapp_webhook: { url, secret_key: secret, events: WEBHOOK_EVENTS, active: true } }),
  });
  return res.data.id;
}

export async function deleteWebhook(phoneNumberId: string, webhookId: string): Promise<void> {
  const res = await fetch(`${PLATFORM_API}/whatsapp/phone_numbers/${phoneNumberId}/webhooks/${webhookId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  // Already gone is fine.
  if (!res.ok && res.status !== 404) throw new KapsoError(`Kapso ${res.status}: ${(await res.text()).slice(0, 300)}`, res.status);
}
