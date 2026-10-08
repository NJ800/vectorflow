import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import { AuthProvider } from "@/lib/auth";
import "./globals.css";

// Both are variable fonts; omitting `weight` keeps the full axis available.
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "VectorFlow",
  description:
    "Operational console for the VectorFlow job recommendation system.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${fraunces.variable} ${inter.variable}`}>
        {/*
          No shared shell here on purpose: the three roles land on
          genuinely different tools (a feed, a management console, a
          stats panel), each building its own chrome below. A single
          imposed nav/rail across all of them is exactly the templated
          look this app is trying to avoid.
        */}
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
