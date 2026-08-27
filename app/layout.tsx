import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import PWAProvider from "./components/PWAProvider";

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
  // appleWebApp (2026-08-27) — iOS Safari has no beforeinstallprompt event
  // (see PWAProvider.tsx's own comment), so there's no in-app "Install" row
  // on an iPhone; the only path is Safari's own Share > Add to Home Screen.
  // This block is what makes that manual result look right: capable: true
  // emits apple-mobile-web-app-capable, so the launched icon opens without
  // Safari's own address bar/chrome (same standalone effect display:
  // "standalone" already gives Android); title sets the name under the icon
  // on the home screen independently of the page <title>, which can differ
  // once a user is deep in the app; statusBarStyle: "default" keeps the
  // iOS status bar opaque (dark text on light) rather than overlaying it on
  // page content — this app has no safe-area padding built in anywhere, so
  // "black-translucent" would draw the WYP header underneath the clock/
  // battery icons.
  appleWebApp: {
    capable: true,
    title: "Would You Please",
    statusBarStyle: "default",
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
        <PWAProvider>{children}</PWAProvider>
      </body>
    </html>
  );
}
