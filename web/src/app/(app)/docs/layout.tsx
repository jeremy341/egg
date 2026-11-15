import { pixel } from "@/lib/fonts";
import { cn } from "@/lib/utils";
import { DocsSectionNav } from "./_components/docs-section-nav";
import { DocsSidebar } from "./_components/docs-sidebar";
import { LegacyHashRedirect } from "./_components/legacy-hash";

/** One grid cell. The reading text sits on a 30px line, so the hairlines fall between lines. */
const GRID_CELL = 30;

/**
 * The docs are one place inside the app shell. From 1280px a sidebar lists
 * every page and the page itself sits beside it, with "On this page" in a
 * rail from 1400px. Below 1280px a section bar sticks under the top bar
 * instead: it names the current page and opens the same list. The pixel face
 * and the hairline grid are the docs' own, as on the public site.
 */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={cn(
        pixel.variable,
        "relative isolate -mx-4 -mt-6 -mb-[calc(96px+env(safe-area-inset-bottom))] pb-[calc(96px+env(safe-area-inset-bottom))] lg:-mx-6 lg:-mb-10 lg:pb-10"
      )}
    >
      <div
        aria-hidden="true"
        className="page-grid pointer-events-none absolute inset-0 -z-10"
        style={{ backgroundSize: `${GRID_CELL}px ${GRID_CELL}px` }}
      />
      <LegacyHashRedirect />
      <DocsSectionNav />
      <a
        href="#docs-article"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-(--z-skip) focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:shadow-menu"
      >
        Skip to the article
      </a>
      <div className="px-4 pt-[30px] pb-[60px] lg:px-6 min-[1280px]:grid min-[1280px]:grid-cols-[200px_minmax(0,1fr)] min-[1280px]:gap-x-10">
        <DocsSidebar />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
