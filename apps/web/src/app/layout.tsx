import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { MessengerApp } from "@/components/MessengerApp";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "cyrillic"],
});

export const metadata: Metadata = {
  title: "Salam",
  description: "Salam — мессенджер. salam-chat.ru",
  appleWebApp: { capable: true, title: "Salam", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b0d10",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full bg-bg font-sans text-ink">
        <MessengerApp />
        {children}
      </body>
    </html>
  );
}
