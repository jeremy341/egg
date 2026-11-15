import Link from "next/link";
import { NestMark } from "@/components/nest-mark";
import { PixelField } from "@/components/pixel-field";
import { pixel } from "@/lib/fonts";
import { cn } from "@/lib/utils";

/** The marketing pill: 40px tall, square, the same as "Sign in" in the top bar. */
const btn =
  "pressable inline-flex h-10 items-center justify-center px-4 text-[14px] font-medium whitespace-nowrap max-sm:w-full";
const btnPrimary =
  "bg-foreground text-background transition-[background-color] duration-(--dur-fast) hover:bg-[color-mix(in_oklab,var(--foreground)_86%,var(--background))]";
const btnSecondary = "shadow-border-base bg-background hover:bg-[var(--ds-gray-100)]";

export default function NotFound() {
  return (
    <div className={cn(pixel.variable, "relative isolate flex min-h-[100dvh] flex-1 flex-col")}>
      <PixelField tone="mono" className="[mask-image:radial-gradient(ellipse_at_center,black_15%,transparent_70%)]" />
      <header className="relative">
        <div className="board-col flex h-[60px] items-center">
          <Link href="/" aria-label="Nest Deploy, home" className="flex min-h-10 w-fit items-center gap-2 outline-offset-4">
            <NestMark className="size-6" />
            <span className="font-pixel text-[19px] leading-none font-semibold whitespace-nowrap">Nest Deploy</span>
          </Link>
        </div>
      </header>
      <main className="relative flex flex-1 flex-col items-center justify-center gap-4 overflow-hidden px-4 pb-[60px] text-center">
        {/* The same stepped wipe as the homepage headline: once, and not at all with reduced motion. */}
        <p className="hero-wipe font-pixel text-[clamp(5rem,14vw,9rem)] leading-none font-medium">404</p>
        <h1 className="text-[24px] leading-8 font-semibold tracking-[-0.025em]">Nothing is listening here</h1>
        <p className="-mt-2 max-w-[36ch] text-muted-foreground">The link may be old, or the page may have moved.</p>
        <div className="mt-2 flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:justify-center">
          <Link href="/" className={cn(btn, btnPrimary)}>
            Back to home
          </Link>
          <Link href="/projects" className={cn(btn, btnSecondary)}>
            Open the dashboard
          </Link>
        </div>
      </main>
    </div>
  );
}
