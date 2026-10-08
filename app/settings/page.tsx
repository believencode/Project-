"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { NeedsBusiness } from "@/components/NeedsBusiness";

export default function SettingsPage() {
  const { business, deleteImportedChats, setBusiness } = useStore();
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  if (!business) return <NeedsBusiness />;
  const imported = business.chats.filter((c) => !c.is_test).length;

  return (
    <main className="page narrow">
      <h1>Settings</h1>

      <div className="card stack">
        <h2>Knowledge sheet</h2>
        <p className="muted">Prices, hours, address and availability the bot answers from.</p>
        <Link href="/review" className="btn">Edit sheet</Link>
      </div>

      <div className="card stack">
        <h2>Imported chats</h2>
        <p className="muted">
          {business.imported_history ? `${imported} one-to-one chats imported from the last 6 months.` : "No imported chat history."} The
          approved sheet stays if you delete them.
        </p>
        {confirm ? (
          <div className="notice warn">
            <p>Delete all imported chat history? This cannot be undone.</p>
            <div className="row">
              <button className="ghost" onClick={() => setConfirm(false)}>Cancel</button>
              <button className="danger" onClick={() => { deleteImportedChats(); setConfirm(false); }}>Delete chats</button>
            </div>
          </div>
        ) : (
          <button className="danger" disabled={!business.imported_history} onClick={() => setConfirm(true)}>Delete imported chats</button>
        )}
      </div>

      <div className="card stack">
        <h2>Prototype</h2>
        <button className="ghost" onClick={() => { setBusiness(null); router.push("/"); }}>Reset prototype and start over</button>
      </div>
    </main>
  );
}
