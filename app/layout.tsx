import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { StoreProvider } from "@/lib/store";
import { TopBar } from "@/components/TopBar";
import { AuthGate } from "@/components/AuthGate";
import { DEFAULT_LANG, isLang, LANG_COOKIE } from "@/lib/i18n";
import { LangProvider } from "@/lib/i18n/react";

export const viewport = { width: "device-width", initialScale: 1 };

export const metadata: Metadata = {
  title: "Kapso Desk",
  description: "WhatsApp Business AI assistant",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const saved = (await cookies()).get(LANG_COOKIE)?.value;
  const lang = isLang(saved) ? saved : DEFAULT_LANG;
  return (
    <html lang={lang}>
      <body>
        <LangProvider initial={lang}>
          <StoreProvider>
            <TopBar />
            <AuthGate>{children}</AuthGate>
          </StoreProvider>
        </LangProvider>
      </body>
    </html>
  );
}
