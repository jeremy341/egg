import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toast";
import { bootScript } from "@/lib/preferences";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Egg",
    template: "%s | Egg",
  },
  description:
    "Push to GitHub and it goes live on your free Hack Club Nest container. Builds, logs, rollbacks and branch previews, no terminal needed.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
    >
      <head>
        {/*
          Sets the colour theme, density and motion choices on <html> from the egg_prefs
          cookie, and hands the mode to next-themes, before the first paint. A
          script rather than cookies() here: reading cookies in the root layout
          would make every public page render per request.
        */}
        <script dangerouslySetInnerHTML={{ __html: bootScript() }} />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <TooltipProvider>
            {children}
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
