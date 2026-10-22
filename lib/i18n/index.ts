import { en, type Key } from "./en";
import { ru } from "./ru";
import { ky } from "./ky";

/**
 * The owner app's language: Russian by default, Kyrgyz or English on request.
 * Works on the server and in the browser; React screens use `useT()` from ./react.
 */

export type { Key };
export type Lang = "ru" | "ky" | "en";
export const DEFAULT_LANG: Lang = "ru";
export const LANG_COOKIE = "kd_lang";

export const LANGS: { id: Lang; label: string; short: string }[] = [
  { id: "ru", label: "Русский", short: "Рус" },
  { id: "ky", label: "Кыргызча", short: "Кыр" },
  { id: "en", label: "English", short: "Eng" },
];

const DICTS: Record<Lang, Record<Key, string>> = { en, ru, ky };

export function isLang(x: unknown): x is Lang {
  return x === "ru" || x === "ky" || x === "en";
}

/** Which plural form: Russian has three (1 цена, 2 цены, 5 цен), English two, Kyrgyz one. */
function pluralForm(lang: Lang, n: number): number {
  if (lang === "ky") return 0;
  if (lang === "en") return n === 1 ? 0 : 1;
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return 0;
  if (d >= 2 && d <= 4 && (dd < 10 || dd >= 20)) return 1;
  return 2;
}

export type Vars = Record<string, string | number>;

export function translate(lang: Lang, key: Key, vars: Vars = {}): string {
  let s = DICTS[lang][key] ?? en[key];
  if (s.includes("|") && typeof vars.n === "number") {
    const forms = s.split("|");
    s = forms[Math.min(pluralForm(lang, vars.n), forms.length - 1)];
  }
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Server errors arrive in English; show the owner's language when we know the message. */
const ERROR_KEYS: Record<string, Key> = Object.fromEntries(
  (Object.keys(en) as Key[]).filter((k) => k.startsWith("err_")).map((k) => [en[k], k]),
);

export function translateError(lang: Lang, message: string): string {
  const key = ERROR_KEYS[message];
  return key ? translate(lang, key) : message;
}
