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
        ["/requests", "Requests"],
        ["/review", "Sheet"],
        ["/settings", "Settings"],
      ]
    : [];
  const waiting = business?.chats.filter((c) => c.needs_person).length ?? 0;
  const pending = business?.chats.flatMap((c) => c.requests ?? []).filter((r) => r.status === "pending").length ?? 0;

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
            {href === "/requests" && pending > 0 ? <span className="badge check" style={{ marginLeft: 6 }}>{pending}</span> : null}
          </Link>
        ))}
      </nav>
      <div className="spacer" />
      {business ? <span className="muted small">{business.sheet.name}</span> : null}
    </header>
  );
}
