import Link from "next/link";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { MobileMenu } from "@/components/marketing/mobile-menu";
import { SiteHeader } from "@/components/marketing/site-header";
import { NestMark } from "@/components/nest-mark";
import { FooterSwitch } from "@/components/marketing/footer-switch";
import { PixelField } from "@/components/pixel-field";
import { ThemeButton } from "@/components/theme-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { pixel } from "@/lib/fonts";
import { NEST_GUIDES_URL, REPO_URL } from "@/lib/site";

const GRID_CELL = 30;

const NAV = [
  { href: "/#product", label: "Product" },
  { href: "/#start", label: "Setup" },
  { href: "/#security", label: "Security" },
  { href: "/#faq", label: "FAQ" },
];

const small =
  "touch-target pressable inline-flex h-8 items-center whitespace-nowrap rounded-full px-2.5 text-[13px] font-medium tracking-[-0.01em] max-sm:h-10";

const footerLink =
  "touch-target w-fit py-1 text-muted-foreground transition-colors duration-(--dur-fast) hover:text-foreground max-sm:py-2.5";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${pixel.variable} relative isolate flex flex-1 flex-col`}>
      {/* Hairlines for the whole page height. The canvas on top only draws what is lit. */}
      <div
        aria-hidden="true"
        className="page-grid pointer-events-none absolute inset-0 -z-10"
        style={{ backgroundSize: `${GRID_CELL}px ${GRID_CELL}px` }}
      />
      <PixelField fixed tone="mono" cell={GRID_CELL} />
      <a
        href="#top"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-(--z-skip) focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:shadow-menu"
      >
        Skip to content
      </a>

      {/* 60px tall: two grid cells, so the bar sits on the grid. */}
      <SiteHeader>
        <div className="mx-auto flex h-15 max-w-[1400px] items-center gap-3 px-6 md:gap-6 lg:gap-8">
          <Link href="/" aria-label="Egg, home" className="touch-target flex shrink-0 items-center gap-2 rounded-md outline-offset-4">
            <NestMark className="size-6" />
            <span className="font-pixel text-[21px] leading-none font-semibold whitespace-nowrap">Egg</span>
          </Link>

          <MarketingNav items={NAV} repoUrl={REPO_URL} />

          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <MobileMenu items={NAV} repoUrl={REPO_URL} />
            <ThemeButton />
            <Link href="/projects" className={`${small} text-muted-foreground hover:bg-[var(--ds-gray-100)] hover:text-foreground max-sm:hidden`}>
              Dashboard
            </Link>
            <Link
              href="/login"
              className={`${small} bg-foreground text-background hover:bg-[color-mix(in_oklab,var(--foreground)_86%,var(--background))]`}
            >
              Sign in
            </Link>
          </div>
        </div>
      </SiteHeader>

      <main id="top" className="flex-1">
        {children}
      </main>

      <FooterSwitch
        full={
          <footer>
            <div className="mx-auto grid max-w-[1400px] gap-12 px-6 py-16 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
              <div>
                <Link href="/" className="touch-target flex w-fit items-center gap-2 rounded-md">
                  <NestMark className="size-6" />
                  <span className="font-pixel text-[21px] leading-none font-semibold">Egg</span>
                </Link>
                <p className="mt-4 max-w-[38ch] text-[14px] leading-6 text-muted-foreground">
                  An add-on that connects to your Hack Club Nest container. Made by a Hack Club member. It is
                  not an official Hack Club product, and the Nest team does not run it.
                </p>
              </div>
              <nav aria-label="Product" className="flex flex-col text-[14px]">
                <p className="mb-2 font-medium">Product</p>
                {NAV.map((n) => (
                  <a key={n.href} href={n.href} className={footerLink}>
                    {n.label}
                  </a>
                ))}
              </nav>
              <nav aria-label="Resources" className="flex flex-col text-[14px]">
                <p className="mb-2 font-medium">Resources</p>
                <Link href="/security" className={footerLink}>
                  How Egg protects your container
                </Link>
                <Link href="/stats" className={footerLink}>
                  Stats
                </Link>
                <a href={REPO_URL} target="_blank" rel="noreferrer" className={footerLink}>
                  Source on GitHub
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
                <a href={NEST_GUIDES_URL} target="_blank" rel="noreferrer" className={footerLink}>
                  Nest guides
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </nav>
              <nav aria-label="Account" className="flex flex-col text-[14px]">
                <p className="mb-2 font-medium">Account</p>
                <Link href="/login" className={footerLink}>
                  Sign in
                </Link>
                <Link href="/projects" className={footerLink}>
                  Dashboard
                </Link>
                <div className="mt-2">
                  <ThemeToggle />
                </div>
              </nav>
            </div>
          </footer>
        }
      />
    </div>
  );
}
