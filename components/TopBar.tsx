"use client";

import Link from "next/link";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { pendingSuggestions } from "@/lib/knowledge";
import { useT } from "@/lib/i18n/react";
import type { Key } from "@/lib/i18n";
import { LanguageSwitch } from "./LanguageSwitch";

/** Small line icons for the phone tab bar. */
const ICONS: Record<string, React.ReactNode> = {
  "/live": <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z" />,
  "/inbox": <path d="M4 5h16v11H8l-4 4zM8 9h8M8 12h5" />,
  "/requests": <path d="M8 4h8v3H8zM6 6H5v15h14V6h-1M8.5 14l2.5 2.5 4.5-5" />,
  "/review": <path d="M5 4h9a3 3 0 013 3v13H8a3 3 0 01-3-3zM5 17a3 3 0 013-3h9" />,
  "/settings": <path d="M12 9a3 3 0 100 6 3 3 0 000-6zM19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7 7 0 01-2 1.2L14.8 21h-4l-.3-2.4a7 7 0 01-2-1.2l-1.9.7-2-3.4 1.6-1.2a7 7 0 010-2.4L4.6 9.9l2-3.4 1.9.7a7 7 0 012-1.2l.3-2h4l.3 2.1a7 7 0 012 1.2l1.9-.7 2 3.4-1.6 1.2a7 7 0 010 2.5z" />,
};

export function TopBar() {
  const path = usePathname();
  const { business, user, logout } = useStore();
  const { t } = useT();
  const router = useRouter();
  const links: [string, Key][] = business?.live
    ? [
        ["/live", "nav_live"],
        ["/inbox", "nav_inbox"],
        ["/requests", "nav_requests"],
        ["/review", "nav_knowledge"],
        ["/settings", "nav_settings"],
      ]
    : [];
  const waiting = business?.chats.filter((c) => c.needs_person).length ?? 0;
  const pending = business?.chats.flatMap((c) => c.requests ?? []).filter((r) => r.status === "pending").length ?? 0;
  const learned = business ? pendingSuggestions(business.chats).length : 0;
  const count: Record<string, number> = { "/inbox": waiting, "/requests": pending, "/review": learned };
  const tone: Record<string, string> = { "/inbox": "alert", "/requests": "check", "/review": "info" };

  // Leave room at the bottom of every page for the phone tab bar.
  const tabs = links.length > 0;
  useEffect(() => {
    document.body.classList.toggle("with-tabs", tabs);
  }, [tabs]);

  return (
    <>
      <header className="topbar">
        <Link href="/" className="brand">
          Jardam<span>chy</span>
        </Link>
        <nav className="nav">
          {links.map(([href, label]) => (
            <Link key={href} href={href} className={path === href ? "active" : ""}>
              {t(label)}
              {count[href] ? <span className={`badge ${tone[href]}`} style={{ marginLeft: 6 }}>{count[href]}</span> : null}
            </Link>
          ))}
        </nav>
        <div className="spacer" />
        {business ? <span className="muted small biz-name">{business.sheet.name}</span> : null}
        <LanguageSwitch />
        {user ? (
          <button
            className="ghost small"
            onClick={async () => {
              await logout();
              router.replace("/login");
            }}
          >
            {t("log_out")}
          </button>
        ) : null}
      </header>
      {tabs ? (
        <nav className="tabbar">
          {links.map(([href, label]) => (
            <Link key={href} href={href} className={path === href ? "active" : ""}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {ICONS[href]}
              </svg>
              {t(label)}
              {count[href] ? <span className="dot">{count[href]}</span> : null}
            </Link>
          ))}
        </nav>
      ) : null}
    </>
  );
}
