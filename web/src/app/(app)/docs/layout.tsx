import { pixel } from "@/lib/fonts";
import { cn } from "@/lib/utils";
import { DocsSectionNav } from "./_components/docs-section-nav";
import { DocsSidebar } from "./_components/docs-sidebar";
import { LegacyHashRedirect } from "./_components/legacy-hash";

/**
 * The docs are one place inside the app shell and draw on the app's own
 * background and surfaces. The app sidebar stays on the left. From 1280px a
 * narrow list of docs pages sits on the app background at the start of the
 * content area, the page reads in a card beside it, and "On this page" sits
 * in a rail after it (see the page). Under 1280px a bar under the top bar
 * names the current page and opens the same list. Only the pixel face is the
 * docs' own.
 */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={cn(pixel.variable, "relative min-[1280px]:grid min-[1280px]:grid-cols-[176px_minmax(0,1fr)] min-[1280px]:gap-x-6")}>
      <LegacyHashRedirect />
      <DocsSectionNav />
      <a
        href="#docs-article"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-(--z-skip) focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:shadow-menu"
      >
        Skip to the article
      </a>
      <DocsSidebar />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
