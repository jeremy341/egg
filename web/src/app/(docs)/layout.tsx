import { Suspense } from "react";
import Link from "next/link";
import "@/components/dashboard.css";
import { NestMark } from "@/components/nest-mark";
import { DocsPageList } from "./docs/_components/docs-sidebar";
import { cn } from "@/lib/utils";

/**
 * The public docs shell. It needs no account, so it does not sit under the app
 * layout (which loads the signed-in user). It has its own top bar, and from
 * 1280px a sidebar with the list of pages; below that the section bar inside
 * the docs layout opens the same list. The "Open Egg" link goes to the
 * dashboard, which asks for a sign-in if there is none.
 */
export default function DocsShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-docs-shell="" className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-(--z-skip) focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:shadow-menu"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-(--z-topbar) flex h-[var(--topbar-height)] shrink-0 items-center gap-3 border-b bg-background-subtle px-4 lg:px-6">
        <Link
          href="/"
          aria-label="Egg home"
          className="touch-target -ml-2 flex size-10 shrink-0 items-center justify-center rounded-md transition-colors duration-(--dur-fast) hover:bg-[var(--ds-gray-alpha-100)]"
        >
          <NestMark className="size-6" />
        </Link>
        <span className="text-[15px] font-medium">Docs</span>
        <Link
          href="/projects"
          className="touch-target ml-auto flex h-8 items-center rounded-md px-3 text-[14px] font-medium text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-[var(--ds-gray-alpha-100)] hover:text-foreground"
        >
          Open Egg
        </Link>
        <Link
          href="/docs/run-yourself"
          className="touch-target flex h-8 items-center rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground transition-colors duration-(--dur-fast) hover:bg-primary-hover"
        >
          Install Egg
        </Link>
      </header>
      <div className="flex min-w-0 flex-1">
        <aside
          aria-label="Docs"
          className="sticky top-[var(--topbar-height)] hidden h-[calc(100dvh-var(--topbar-height))] w-[288px] shrink-0 overflow-y-auto border-r bg-background-subtle p-2 min-[1280px]:block"
        >
          <Suspense fallback={null}>
            <DocsPageList />
          </Suspense>
        </aside>
        <main
          id="main"
          className={cn(
            "mx-auto w-full min-w-0 max-w-[var(--page-width)] flex-1 px-4 py-6 pb-[calc(96px+env(safe-area-inset-bottom))] lg:px-6 lg:pb-10",
            // Docs pages use a centered column, like the Orchard docs, instead
            // of hugging the sidebar. The page itself sets its own max width.
            "has-[[data-docs-page]]:max-w-[900px]"
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
