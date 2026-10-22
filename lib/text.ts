/** Small Russian text helpers shared by the rules and the booking/order logic. */

export function normalize(text: string): string {
  return text.toLowerCase().replace(/ё/g, "е");
}

export function words(text: string): string[] {
  return normalize(text).split(/[^a-zа-я0-9]+/).filter(Boolean);
}

/** Crude Russian stemming: compare the first 4 letters of each word. */
function stems(text: string): string[] {
  return words(text)
    .filter((w) => w.length >= 3)
    .map((w) => w.slice(0, 4));
}

/** True when every stem of `phrase` starts some word of `message`. */
export function mentions(message: string, phrase: string): boolean {
  const msgWords = words(message);
  const need = stems(phrase);
  return need.length > 0 && need.every((s) => msgWords.some((w) => w.startsWith(s)));
}

/**
 * Items the message refers to. "Белые кроссовки" matches on all its words; a
 * single distinctive word ("лоферы") is enough when no other item shares it.
 */
export function findItems(message: string, items: string[]): string[] {
  const full = items.filter((i) => mentions(message, i));
  if (full.length > 0) return full;
  const last = (i: string) => words(i).at(-1) ?? "";
  return items.filter((i) => {
    const noun = last(i);
    if (noun.length < 3 || !mentions(message, noun)) return false;
    return items.filter((j) => last(j).slice(0, 4) === noun.slice(0, 4)).length === 1;
  });
}

/** Kyrgyz-only letters, or Kyrgyz words written with Russian letters. */
const KYRGYZ_LETTERS = /[ңөүҢӨҮ]/;
/** Words that only exist in Kyrgyz: one is enough. */
const KYRGYZ_STRONG = new Set([
  "саламатсызбы", "рахмат", "канча", "турат", "барбы", "кайда", "качан", "кандай", "берчи", "керек", "эмне",
  "ооба", "кечирип", "чейин", "иштейсиз", "иштейсиздер", "болобу", "сиздер", "сизде",
]);
/** Words that look Russian too (бар, салам, ак): two are needed. */
const KYRGYZ_WEAK = new Set(["бар", "жок", "салам", "мага", "сиз", "менен", "ак", "кара", "жакшы", "алам"]);

/**
 * The customer's language, decided in code so the model can't guess wrong:
 * Kyrgyz if the message has Kyrgyz letters, a word only Kyrgyz has, or two
 * words common in Kyrgyz; otherwise Russian.
 */
export function detectLanguage(text: string): "ru" | "ky" {
  if (KYRGYZ_LETTERS.test(text)) return "ky";
  const ws = words(text);
  if (ws.some((w) => KYRGYZ_STRONG.has(w))) return "ky";
  return ws.filter((w) => KYRGYZ_WEAK.has(w)).length >= 2 ? "ky" : "ru";
}
