import type { Business } from "./types";
import { cafeChats, cafeSheet, shoeChats, shoeSheet, testChat } from "./fixtures";

/** A demo business: the shoe shop or the café, with its sample chats and the test chat. */
export function demoBusiness(kind: "shop" | "cafe", name?: string): Business {
  const now = Date.now();
  const sheet = kind === "cafe" ? cafeSheet(name) : shoeSheet(name);
  const chats = kind === "cafe" ? cafeChats(now) : shoeChats(now);
  return { id: `biz-${now}-${Math.random().toString(36).slice(2, 6)}`, sheet, chats: [...chats, testChat()], imported_history: true, live: false };
}
