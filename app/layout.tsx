import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

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
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
