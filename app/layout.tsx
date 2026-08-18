import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import ServiceWorkerRegister from "./components/ServiceWorkerRegister";

// Palette 1 specifies Inter across every screen. The mockups pull it from
// Google Fonts via <link>; next/font self-hosts it instead, which removes the
// external request and the layout shift on first paint.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Would You Please",
  description: "Tracking Requests and ToDos",
  // Icons (2026-08-18) — see app/manifest.ts's own header comment for the
  // full write-up on where these come from and why they were added now.
  // manifest.webmanifest itself is linked automatically by Next.js's
  // app/manifest.ts route convention; no manual <link rel="manifest"> here.
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/icon-512.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full">
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
