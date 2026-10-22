"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Business, Chat, Message, ReplyDecision, Sheet } from "./types";
import {
  historyOf,
  needsClassification,
  openChat,
  receiveClassified,
  receiveUnclassified,
  resumeBot,
  settleRequest,
  skipThirtyMinutes,
  staffReply,
} from "./engine";
import { cafeChats, cafeSheet, shoeChats, shoeSheet, testChat } from "./fixtures";
import { decideWithRules } from "./rules";

const STORAGE_KEY = "kapso-desk:v1";

interface Store {
  ready: boolean;
  business: Business | null;
  setBusiness: (b: Business | null) => void;
  updateSheet: (fn: (s: Sheet) => Sheet) => void;
  goLive: () => void;
  sendCustomer: (chatId: string, text: string, kind?: Message["kind"]) => Promise<ReplyDecision | null>;
  sendStaff: (chatId: string, text: string, source?: "inbox" | "echo") => void;
  resume: (chatId: string) => void;
  skip30: (chatId: string) => void;
  open: (chatId: string) => void;
  settle: (chatId: string, requestId: string, ok: boolean) => Promise<void>;
  resetTestChat: () => void;
  deleteImportedChats: () => void;
}

const Ctx = createContext<Store | null>(null);

export function demoBusiness(kind: "shop" | "cafe", name?: string): Business {
  const now = Date.now();
  const sheet = kind === "cafe" ? cafeSheet(name) : shoeSheet(name);
  const chats = kind === "cafe" ? cafeChats(now) : shoeChats(now);
  return { id: `biz-${now}`, sheet, chats: [...chats, testChat()], imported_history: true, live: false };
}

/** Send one customer message to the server, which classifies, decides and writes the reply. */
async function serverTurn(chat: Chat, sheet: Sheet, text: string, kind: Message["kind"]): Promise<TurnResult> {
  try {
    const res = await fetch("/api/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat, sheet, text, kind }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as TurnResult;
  } catch {
    // No server (static export or offline): the demo rules run in the browser.
    const now = Date.now();
    if (!needsClassification(chat, kind, now)) return { chat: receiveUnclassified(chat, text, kind, now), decision: null };
    const decision = decideWithRules(text, sheet, historyOf(chat), chat.draft ?? null);
    return { chat: receiveClassified(chat, text, decision, sheet, now), decision };
  }
}

interface TurnResult {
  chat: Chat;
  decision: ReplyDecision | null;
  ai_error?: boolean;
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [business, setBusinessState] = useState<Business | null>(null);
  const [ready, setReady] = useState(false);
  const ref = useRef<Business | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const b = JSON.parse(raw) as Business;
        ref.current = b;
        setBusinessState(b);
      }
    } catch {
      /* storage unavailable: start empty */
    }
    setReady(true);
  }, []);

  const commit = useCallback((b: Business | null) => {
    ref.current = b;
    setBusinessState(b);
    try {
      if (b) localStorage.setItem(STORAGE_KEY, JSON.stringify(b));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const mapChat = useCallback(
    (chatId: string, fn: (c: Chat) => Chat) => {
      const b = ref.current;
      if (!b) return;
      commit({ ...b, chats: b.chats.map((c) => (c.id === chatId ? fn(c) : c)) });
    },
    [commit],
  );

  const sendCustomer = useCallback(
    async (chatId: string, text: string, kind: Message["kind"] = "text") => {
      const b = ref.current;
      const chat = b?.chats.find((c) => c.id === chatId);
      if (!b || !chat) return null;
      const result = await serverTurn(chat, b.sheet, text, kind);
      mapChat(chatId, (current) =>
        // Staff may have replied while the AI was working: keep their reply, don't answer over it.
        current.messages.length === chat.messages.length ? result.chat : receiveUnclassified(current, text, kind, Date.now()),
      );
      return result.decision;
    },
    [mapChat],
  );

  const settle = useCallback(
    async (chatId: string, requestId: string, ok: boolean) => {
      const b = ref.current;
      const chat = b?.chats.find((c) => c.id === chatId);
      if (!b || !chat) return;
      try {
        const res = await fetch("/api/settle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat, sheet: b.sheet, requestId, ok }),
        });
        const body = (await res.json()) as { chat?: Chat; error?: string };
        if (!res.ok || !body.chat) {
          alert(body.error ?? "Could not send the message. Try again.");
          return;
        }
        mapChat(chatId, () => body.chat!);
      } catch {
        mapChat(chatId, (c) => settleRequest(c, requestId, ok, Date.now()));
      }
    },
    [mapChat],
  );

  const store: Store = {
    ready,
    business,
    setBusiness: commit,
    updateSheet: (fn) => {
      const b = ref.current;
      if (b) commit({ ...b, sheet: fn(b.sheet) });
    },
    goLive: () => {
      const b = ref.current;
      if (b) commit({ ...b, live: true });
    },
    sendCustomer,
    sendStaff: (chatId, text, source = "inbox") => mapChat(chatId, (c) => staffReply(c, text, Date.now(), source)),
    resume: (chatId) => mapChat(chatId, (c) => resumeBot(c, Date.now())),
    skip30: (chatId) => mapChat(chatId, (c) => skipThirtyMinutes(c, Date.now())),
    open: (chatId) => mapChat(chatId, openChat),
    settle,
    resetTestChat: () => mapChat("test", () => testChat()),
    deleteImportedChats: () => {
      const b = ref.current;
      if (b) commit({ ...b, chats: b.chats.filter((c) => c.is_test), imported_history: false });
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
