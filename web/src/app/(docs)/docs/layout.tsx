import { pixel } from "@/lib/fonts";
import { cn } from "@/lib/utils";
import { DocsSectionNav } from "./_components/docs-section-nav";
import { LegacyHashRedirect } from "./_components/legacy-hash";

/**
 * The docs draw on the public docs shell's background (`(docs)/layout.tsx`),
 * which needs no sign-in. The list of pages lives in that shell's sidebar (from
 * 1280px), so the frame holds only the reading column, set directly on the
 * background (no card), and "On this page" in a rail after it (see the page).
 * Under 1280px a bar under the top bar names the current page and opens the
 * list. All docs text is left aligned. Only the pixel face is the docs' own.
 */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={cn(pixel.variable, "relative text-left")}>
      <LegacyHashRedirect />
      <DocsSectionNav />
      <a
        href="#docs-article"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-(--z-skip) focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:shadow-menu"
      >
        Skip to the article
      </a>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
