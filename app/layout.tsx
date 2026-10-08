import type { Metadata } from "next";
import "./globals.css";
import { StoreProvider } from "@/lib/store";
import { TopBar } from "@/components/TopBar";

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
          {children}
        </StoreProvider>
      </body>
    </html>
  );
}
