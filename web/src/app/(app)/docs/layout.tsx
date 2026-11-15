import { DocsSectionNav } from "./_components/docs-section-nav";
import { LegacyHashRedirect } from "./_components/legacy-hash";

/**
 * The docs inside the app shell. The app sidebar already carries the main
 * navigation, so the docs add no second sidebar: a section bar sticks under the
 * top bar (it names the current page and opens the list of pages), and the page
 * itself sits below it, with "On this page" in a rail from 1280px.
 */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <LegacyHashRedirect />
      <DocsSectionNav />
      <a
        href="#docs-article"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-(--z-skip) focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:shadow-menu"
      >
        Skip to the article
      </a>
      <div className="min-w-0 pt-8 pb-10">{children}</div>
    </div>
  );
}
