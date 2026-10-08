"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { demoBusiness, useStore } from "@/lib/store";

export default function Home() {
  const { ready, business, setBusiness } = useStore();
  const router = useRouter();
  if (!ready) return null;

  return (
    <main className="page narrow">
      <div className="card stack">
        <h1>Kapso Desk</h1>
        <p>
          Connect your WhatsApp Business number. We read your old one-to-one chats and set up a bot that answers only your
          business&apos;s questions. Staff keep using WhatsApp Business on the phone.
        </p>
        {business ? (
          <div className="notice">
            <strong>{business.sheet.name}</strong> is {business.live ? "live" : "not live yet"}.{" "}
            <Link href={business.live ? "/live" : "/setup"}>{business.live ? "Open" : "Continue setup"}</Link>
          </div>
        ) : null}
        <div className="row">
          <button
            className="primary"
            onClick={() => {
              setBusiness(null);
              router.push("/setup");
            }}
          >
            Set up a business
          </button>
          <button
            onClick={() => {
              setBusiness({ ...demoBusiness("shop"), live: true });
              router.push("/review");
            }}
          >
            Skip to the demo shoe shop
          </button>
        </div>
        <p className="muted small">
          Prototype: WhatsApp connection, chat sync and sending are mocked. Pick «Café» in setup to see the café demo.
        </p>
      </div>
    </main>
  );
}
