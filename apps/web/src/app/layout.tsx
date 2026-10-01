import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import { Shell } from "@/components/Shell";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "cyrillic"],
});

const description = "Мессенджер Salam. Чаты, голосовые и звонки.";

export const metadata: Metadata = {
  metadataBase: new URL("https://salam-chat.ru"),
  title: "Salam",
  description,
  applicationName: "Salam",
  appleWebApp: { capable: true, title: "Salam", statusBarStyle: "black-translucent" },
  openGraph: {
    title: "Salam",
    description,
    url: "https://salam-chat.ru",
    siteName: "Salam",
    locale: "ru_RU",
    alternateLocale: ["ky_KG"],
    type: "website",
    images: [{ url: "/apple-icon.png", width: 180, height: 180, alt: "Salam" }],
  },
  twitter: { card: "summary", title: "Salam", description, images: ["/apple-icon.png"] },
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
        <Script id="salam-lang" strategy="beforeInteractive">
          {`try{var l=localStorage.getItem("tooapp.lang")||localStorage.getItem("samal.lang");if(l==="ky"||l==="ru")document.documentElement.lang=l}catch(e){}`}
        </Script>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
