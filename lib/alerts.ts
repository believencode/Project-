import type { AlertSettings, Chat, NeedsPerson, NeedsPersonReason } from "./types";
import type { BusinessRow } from "./repo";
import { kapsoEnabled, sendTemplate, sendText } from "./kapso";
import { translate, type Key, type Lang } from "./i18n";
import { publicUrl } from "./url";

/**
 * Server only. When a chat starts needing a person, tell the owner on WhatsApp:
 * who is waiting, what they asked, and a link straight to the chat.
 *
 * Sent from ALERT_PHONE_NUMBER_ID (a Jardamchy number) or else the business's own
 * number. With ALERT_TEMPLATE set, it's a Meta-approved template, which WhatsApp
 * delivers at any time; without one, a plain message, which WhatsApp delivers only
 * if the owner's number wrote to the sending number in the last 24 hours.
 *
 * Template body, {{1}} customer, {{2}} what they asked, {{3}} link:
 *   ru: Клиент {{1}} ждёт ответа: «{{2}}». Ответить: {{3}}
 */

const REASON: Record<NeedsPersonReason, Key> = {
  "Off-topic": "reason_off_topic",
  "Missing answer": "reason_missing",
  "Voice/photo": "reason_voice",
  "Booking/order": "reason_booking",
  "AI unavailable": "reason_ai",
};

/** Template language codes as WhatsApp names them. */
const TEMPLATE_LANG: Record<Lang, string> = { ru: "ru", ky: "ky_KG", en: "en" };

/**
 * "+996 555 123 456", "0555 123 456" (a local Kyrgyz number) or "996555123456" →
 * "996555123456". Null when it can't be a phone number.
 */
export function normalizePhone(input: string): string | null {
  let d = input.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (/^0\d{9}$/.test(d)) d = `996${d.slice(1)}`;
  return /^\d{10,15}$/.test(d) ? d : null;
}

/** The flag to alert about: the chat needs a person now and didn't before (or for another reason). */
export function newFlag(before: Chat, after: Chat): NeedsPerson | null {
  const flag = after.needs_person;
  if (!flag) return null;
  return before.needs_person?.reason === flag.reason ? null : flag;
}

/** Template variables can't hold line breaks or long runs of spaces. */
const oneLine = (s: string, max = 160) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

export function alertParts(lang: Lang, chat: Chat, flag: NeedsPerson) {
  const t = (key: Key, vars?: Record<string, string>) => translate(lang, key, vars);
  const customer = oneLine(chat.customer, 60);
  const detail = oneLine(flag.details.at(-1) || t(REASON[flag.reason]));
  const base = publicUrl();
  const link = base ? `${base}/inbox?chat=${encodeURIComponent(chat.id)}` : "";
  const text = [t("alert_msg", { customer, reason: t(REASON[flag.reason]), detail }), link && t("alert_link", { link })]
    .filter(Boolean)
    .join("\n");
  return { customer, detail, link, text };
}

export type AlertResult = "sent" | "skipped" | "failed";

/** Send one alert. Never throws: a missing alert must not break the customer's chat. */
export async function sendAlert(row: BusinessRow, settings: AlertSettings | undefined, parts: { text: string; params: string[] }): Promise<AlertResult> {
  if (!settings?.enabled || !settings.phone || !kapsoEnabled()) return "skipped";
  const from = process.env.ALERT_PHONE_NUMBER_ID || row.kapso_phone_number_id;
  if (!from) return "skipped";
  const template = process.env.ALERT_TEMPLATE;
  try {
    if (template) {
      try {
        await sendTemplate(from, settings.phone, template, TEMPLATE_LANG[settings.lang], parts.params);
        return "sent";
      } catch (err) {
        // The template may only be approved in Russian so far.
        if (settings.lang === "ru") throw err;
        await sendTemplate(from, settings.phone, template, TEMPLATE_LANG.ru, parts.params);
        return "sent";
      }
    }
    await sendText(from, settings.phone, parts.text);
    return "sent";
  } catch (err) {
    console.error("Could not send the owner an alert:", err);
    return "failed";
  }
}

/** Alert the owner if this change made the chat need a person. */
export async function alertIfNeeded(row: BusinessRow, before: Chat, after: Chat): Promise<AlertResult> {
  const flag = newFlag(before, after);
  const settings = row.data.alerts;
  if (!flag || !settings) return "skipped";
  const parts = alertParts(settings.lang, after, flag);
  const result = await sendAlert(row, settings, { text: parts.text, params: [parts.customer, parts.detail, parts.link || "—"] });
  if (result === "sent") console.log(`WhatsApp 🔔 alerted the owner: ${after.customer} needs a person (${flag.reason})`);
  return result;
}
