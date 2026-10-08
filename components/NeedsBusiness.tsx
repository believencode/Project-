"use client";

import Link from "next/link";
import { useStore } from "@/lib/store";

export function NeedsBusiness() {
  const { ready } = useStore();
  if (!ready) return null;
  return (
    <main className="page narrow">
      <div className="card">
        <h1>No business yet</h1>
        <p>Finish setup first.</p>
        <Link className="btn primary" href="/">Start</Link>
      </div>
    </main>
  );
}
