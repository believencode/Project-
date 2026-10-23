import type { Key } from "../i18n";

/** Kapso's setup-link error codes in plain words (shown on /connect/failed). */
const REASON: Record<string, Key> = {
  facebook_auth_failed: "fail_auth",
  phone_verification_failed: "fail_phone",
  waba_limit_reached: "fail_waba_limit",
  token_exchange_failed: "fail_token",
  link_expired: "fail_expired",
  already_used: "fail_used",
};

export function failureReason(code: string | null): Key {
  return (code && REASON[code]) || "fail_unknown";
}
