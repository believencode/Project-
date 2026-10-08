"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Business, Chat, Message, ReplyDecision, Sheet } from "./types";
import {
  needsClassification,
  openChat,
  receiveClassified,
  receiveUnclassified,
  resumeBot,
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

async function decide(text: string, sheet: Sheet): Promise<ReplyDecision> {
  try {
    const res = await fetch("/api/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, sheet }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as ReplyDecision;
  } catch {
    // Offline or static export: the same rules run in the browser.
    return decideWithRules(text, sheet);
  }
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
      if (!needsClassification(chat, kind, Date.now())) {
        mapChat(chatId, (c) => receiveUnclassified(c, text, kind, Date.now()));
        return null;
      }
      const decision = await decide(text, b.sheet);
      const type = ref.current?.sheet.type ?? b.sheet.type;
      mapChat(chatId, (c) =>
        // Staff may have replied while the classifier ran.
        needsClassification(c, kind, Date.now())
          ? receiveClassified(c, text, decision, type, Date.now())
          : receiveUnclassified(c, text, kind, Date.now()),
      );
      return decision;
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
