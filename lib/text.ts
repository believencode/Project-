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
