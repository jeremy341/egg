"use client";

import { useEffect } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { AppError } from "@/components/app-error";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

/**
 * Replaces the root layout when it fails, so it brings its own html, body and
 * styles. The theme provider is gone too, so the saved or system theme is
 * applied here.
 */
export default function GlobalError({
  error,
  reset,
  retry,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  retry?: () => void;
}) {
  useEffect(() => {
    let dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    try {
      const saved = localStorage.getItem("theme");
      if (saved === "dark") dark = true;
      else if (saved === "light") dark = false;
    } catch {
      // Storage can be blocked; the system theme is fine.
    }
    document.documentElement.classList.toggle("dark", dark);
  }, []);

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <title>Something went wrong</title>
        <main>
          <AppError fullPage digest={error.digest} onRetry={retry ?? reset} />
        </main>
      </body>
    </html>
  );
}
