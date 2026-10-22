"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Business, Chat, Message, ReplyDecision, Sheet } from "./types";
import { newFactId } from "./knowledge";

/**
 * The web app's view of the server. Everything is saved in the database through
 * the API; the store keeps a copy for the screens and refreshes it every few
 * seconds so WhatsApp messages appear on their own.
 */

interface Store {
  ready: boolean;
  /** Logged-in owner's email, or null when logged out. */
  user: string | null;
  business: Business | null;
  /** The Kapso number this business answers on, if connected. */
  whatsapp: string | null;
  /** The last request that failed, for a small error banner. */
  error: string | null;
  clearError: () => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  setBusiness: (b: Business | null) => Promise<void>;
  updateSheet: (fn: (s: Sheet) => Sheet) => void;
  goLive: () => Promise<void>;
  sendCustomer: (chatId: string, text: string, kind?: Message["kind"]) => Promise<ReplyDecision | null>;
  /** `echo` simulates a reply from the WhatsApp Business app (test chat only). */
  sendStaff: (chatId: string, text: string, source?: "inbox" | "echo") => Promise<void>;
  resume: (chatId: string) => Promise<void>;
  skip30: (chatId: string) => Promise<void>;
  open: (chatId: string) => Promise<void>;
  settle: (chatId: string, requestId: string, ok: boolean) => Promise<void>;
  resetTestChat: () => Promise<void>;
  /** Add a fact learned from a staff answer to the knowledge base, or dismiss it. */
  settleSuggestion: (chatId: string, suggestionId: string, fact: { topic: string; text: string } | null) => Promise<void>;
  deleteImportedChats: () => Promise<void>;
}

const Ctx = createContext<Store | null>(null);

export { demoBusiness } from "./demo";

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function api<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  return data;
}

const REFRESH_MS = 3000;
/** Errors are already shown in the banner; callers don't need to handle them. */
const quiet = () => undefined;
const SHEET_SAVE_MS = 500;

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<string | null>(null);
  const [business, setBusinessState] = useState<Business | null>(null);
  const [whatsapp, setWhatsapp] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<Business | null>(null);
  // Changes go to the server one at a time, in order.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const sheetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sheetDirty = useRef(false);

  const show = useCallback((b: Business | null) => {
    ref.current = b;
    setBusinessState(b);
  }, []);

  const enqueue = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.current.then(fn, fn);
    queue.current = run.catch(() => undefined);
    return run.catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err));
      if (err instanceof ApiError && err.status === 401) setUser(null);
      throw err;
    });
  }, []);

  const load = useCallback(async () => {
    try {
      const me = await api<{ email: string | null }>("GET", "/api/me");
      if (!me.email) {
        setUser(null);
        show(null);
        return;
      }
      const { business: b, whatsapp: wa } = await api<{ business: Business | null; whatsapp: string | null }>("GET", "/api/business");
      setUser(me.email);
      setWhatsapp(wa);
      // Keep sheet edits that haven't been saved yet.
      show(b && sheetDirty.current && ref.current ? { ...b, sheet: ref.current.sheet } : b);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setUser(null);
        show(null);
      }
    } finally {
      setReady(true);
    }
  }, [show]);

  useEffect(() => {
    void load();
  }, [load]);

  // Refresh while the page is visible, so new WhatsApp messages show up.
  useEffect(() => {
    if (!user) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [user, load]);

  const replaceChat = useCallback(
    (chat: Chat) => {
      const b = ref.current;
      if (b) show({ ...b, chats: b.chats.map((c) => (c.id === chat.id ? chat : c)) });
    },
    [show],
  );

  const chatAction = useCallback(
    <T extends { chat: Chat },>(chatId: string, action: string, body: unknown = {}) =>
      enqueue(async () => {
        const out = await api<T>("POST", `/api/chats/${encodeURIComponent(chatId)}/${action}`, body);
        replaceChat(out.chat);
        return out;
      }),
    [enqueue, replaceChat],
  );

  const flushSheet = useCallback(() => {
    if (sheetTimer.current) clearTimeout(sheetTimer.current);
    sheetTimer.current = null;
    if (!sheetDirty.current || !ref.current) return queue.current;
    const sheet = ref.current.sheet;
    return enqueue(async () => {
      await api("PATCH", "/api/business", { sheet });
      if (ref.current?.sheet === sheet) sheetDirty.current = false;
    }).catch(quiet);
  }, [enqueue]);

  const store: Store = {
    ready,
    user,
    business,
    whatsapp,
    error,
    clearError: () => setError(null),
    refresh: load,
    logout: async () => {
      await api("POST", "/api/auth/logout").catch(() => undefined);
      setUser(null);
      show(null);
    },
    setBusiness: async (b) => {
      show(b);
      await enqueue(async () => {
        if (!b) {
          await api("DELETE", "/api/business");
          setWhatsapp(null);
          return;
        }
        const out = await api<{ business: Business; whatsapp: string | null }>("PUT", "/api/business", b);
        show(out.business);
        setWhatsapp(out.whatsapp);
      }).catch(quiet);
    },
    updateSheet: (fn) => {
      const b = ref.current;
      if (!b) return;
      show({ ...b, sheet: fn(b.sheet) });
      sheetDirty.current = true;
      if (sheetTimer.current) clearTimeout(sheetTimer.current);
      sheetTimer.current = setTimeout(() => void flushSheet(), SHEET_SAVE_MS);
    },
    goLive: async () => {
      const b = ref.current;
      if (!b) return;
      show({ ...b, live: true });
      await flushSheet();
      await enqueue(() => api("PATCH", "/api/business", { live: true })).catch(quiet);
    },
    sendCustomer: async (chatId, text, kind = "text") => {
      const out = await chatAction<{ chat: Chat; decision?: ReplyDecision | null }>(chatId, "customer", { text, kind }).catch(() => null);
      return out?.decision ?? null;
    },
    sendStaff: async (chatId, text, source = "inbox") => {
      await chatAction(chatId, "staff", { text, source }).catch(quiet);
    },
    resume: async (chatId) => {
      await chatAction(chatId, "resume").catch(quiet);
    },
    skip30: async (chatId) => {
      await chatAction(chatId, "skip30").catch(quiet);
    },
    open: async (chatId) => {
      await chatAction(chatId, "open").catch(quiet);
    },
    settle: async (chatId, requestId, ok) => {
      await chatAction(chatId, "settle", { requestId, ok }).catch(quiet);
    },
    resetTestChat: async () => {
      await chatAction("test", "reset").catch(quiet);
    },
    settleSuggestion: async (chatId, suggestionId, fact) => {
      if (fact) {
        const b = ref.current;
        if (!b) return;
        // Added by the owner, so it's confirmed; the owner is the source.
        const added = { id: newFactId(), topic: fact.topic.trim(), text: fact.text.trim(), needs_check: false, source: { by: "owner" as const, at: Date.now() } };
        show({ ...b, sheet: { ...b.sheet, facts: [...(b.sheet.facts ?? []), added] } });
        sheetDirty.current = true;
        await flushSheet();
      }
      await chatAction(chatId, "suggestion", { suggestionId, status: fact ? "added" : "dismissed" }).catch(quiet);
    },
    deleteImportedChats: async () => {
      await enqueue(() => api("DELETE", "/api/chats/imported")).catch(quiet);
      await load();
    },
  };

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside StoreProvider");
  return s;
}

/** Current time, refreshed every second, for pause countdowns. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}
