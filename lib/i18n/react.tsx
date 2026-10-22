"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { LANG_COOKIE, translate, translateError, type Key, type Lang, type Vars } from "./index";

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void } | null>(null);

/** The language comes from a cookie, so the server renders the same text the browser shows. */
export function LangProvider({ initial, children }: { initial: Lang; children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = l;
  }, []);
  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useT() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useT outside LangProvider");
  const { lang, setLang } = ctx;
  const t = useCallback((key: Key, vars?: Vars) => translate(lang, key, vars), [lang]);
  const tError = useCallback((message: string) => translateError(lang, message), [lang]);
  return { t, tError, lang, setLang };
}
