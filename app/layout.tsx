import type { Metadata } from "next";
import { Instrument_Serif } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

// UI sans — buttons, HUD, NPC dialog, card description, journal guides,
// settings, report body. Self-hosted woff2 (Fontshare → app/fonts).
const zodiak = localFont({
  variable: "--font-zodiak",
  display: "swap",
  src: [
    { path: "./fonts/zodiak-light.woff2",   weight: "300", style: "normal" },
    { path: "./fonts/zodiak-regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/zodiak-bold.woff2",    weight: "700", style: "normal" },
  ],
});

// Literary serif — room intros, event prompts, narrations, poems, large titles.
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "twr — talisman",
  description: "the white room",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${zodiak.variable} ${instrumentSerif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
