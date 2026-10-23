"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { pendingSuggestions } from "@/lib/knowledge";
import { useT } from "@/lib/i18n/react";
import type { Key } from "@/lib/i18n";
import { LanguageSwitch } from "./LanguageSwitch";

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

  return (
    <header className="topbar">
      <Link href="/" className="brand">
        Jardam<span>chy</span>
      </Link>
      <nav className="nav">
        {links.map(([href, label]) => (
          <Link key={href} href={href} className={path === href ? "active" : ""}>
            {t(label)}
            {href === "/inbox" && waiting > 0 ? <span className="badge alert" style={{ marginLeft: 6 }}>{waiting}</span> : null}
            {href === "/requests" && pending > 0 ? <span className="badge check" style={{ marginLeft: 6 }}>{pending}</span> : null}
            {href === "/review" && learned > 0 ? <span className="badge info" style={{ marginLeft: 6 }}>{learned}</span> : null}
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
  );
}
