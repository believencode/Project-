"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useStore } from "@/lib/store";

export function TopBar() {
  const path = usePathname();
  const { business } = useStore();
  const links = business?.live
    ? [
        ["/live", "Live"],
        ["/inbox", "Inbox"],
        ["/review", "Sheet"],
        ["/settings", "Settings"],
      ]
    : [];
  const waiting = business?.chats.filter((c) => c.needs_person).length ?? 0;

  return (
    <header className="topbar">
      <Link href="/" className="brand">
        Kapso <span>Desk</span>
      </Link>
      <nav className="nav">
        {links.map(([href, label]) => (
          <Link key={href} href={href} className={path === href ? "active" : ""}>
            {label}
            {href === "/inbox" && waiting > 0 ? <span className="badge alert" style={{ marginLeft: 6 }}>{waiting}</span> : null}
          </Link>
        ))}
      </nav>
      <div className="spacer" />
      {business ? <span className="muted small">{business.sheet.name}</span> : null}
    </header>
  );
}
