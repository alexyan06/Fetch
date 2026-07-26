// FROZEN — do not edit after Phase 0.
//
// <CorgiMascot /> and <Toaster /> are mounted here once, both pointing at
// self-contained components. Later work fills those components in without ever
// touching this file, which keeps them off the merge-conflict surface.

import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { CorgiMascot } from "@/components/corgi";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Fetch",
  description:
    "Coverage that keeps up. Watches a portfolio's real business signals and adjusts insurance limits — automatically when it's routine, with a human when it isn't.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <CorgiMascot />
        <Toaster />
      </body>
    </html>
  );
}
