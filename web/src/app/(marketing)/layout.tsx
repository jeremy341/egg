import { PixelField } from "@/components/pixel-field";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { pixel } from "@/lib/fonts";

const GRID_CELL = 30;

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
        className="sr-only focus:not-sr-only focus:fixed focus:top-16 focus:left-4 focus:z-(--z-skip) focus:bg-background focus:px-3 focus:py-2 focus:shadow-menu"
      >
        Skip to content
      </a>

      <SiteHeader />

      <main id="top" className="flex-1">
        {children}
      </main>

      <SiteFooter />
    </div>
  );
}
