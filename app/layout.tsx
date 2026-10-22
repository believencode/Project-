import type { Metadata } from "next";
import "./globals.css";
import { StoreProvider } from "@/lib/store";
import { TopBar } from "@/components/TopBar";
import { AuthGate } from "@/components/AuthGate";

export const viewport = { width: "device-width", initialScale: 1 };

export const metadata: Metadata = {
  title: "Kapso Desk",
  description: "WhatsApp Business bot prototype",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <StoreProvider>
          <TopBar />
          <AuthGate>{children}</AuthGate>
        </StoreProvider>
      </body>
    </html>
  );
}
