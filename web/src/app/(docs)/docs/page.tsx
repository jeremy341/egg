import Link from "next/link";
import { cn } from "@/lib/utils";
import { docsHref } from "./_data/nav";
import { CopyPromptButton } from "./_components/copy-prompt";
import { DocsBrowse } from "./_components/docs-browse";
import { DocsIndex } from "./_components/docs-index";
import { ARTICLE, PageHeader } from "./_components/prose";
import { StartHere } from "./_components/start-here";

export const metadata = {
  title: "Docs",
  description:
    "How Egg works: connecting a Nest server, deploying from GitHub, environment variables, domains, monitoring, analytics, security and limits.",
};

/** The docs home: where to start, then one index of every page, grouped like the sidebar. */
export default function DocsHome() {
  return (
    <article id="docs-article" data-docs-page="index" data-docs-body tabIndex={-1} className={cn(ARTICLE, "outline-none max-w-[1040px] min-[1536px]:max-w-[1040px]")}>
      <PageHeader
        tag="Documentation"
        title="Docs"
        titleId="docs-h"
        lead="How to connect your Nest container, deploy to it and keep an eye on it. New here? Read how it works, then the quick start. Every other page is listed below with what it covers."
      />
      <div className="my-6 flex flex-wrap items-center gap-3">
        <Link href={docsHref("overview")} className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-[15px] font-medium text-primary-foreground transition-colors duration-(--dur-fast) hover:bg-primary-hover">
          Get started
        </Link>
        <Link href={docsHref("run-yourself")} className="inline-flex h-10 items-center rounded-md border px-4 text-[15px] font-medium text-foreground transition-colors duration-(--dur-fast) hover:bg-[var(--ds-gray-alpha-100)]">
          Install Egg
        </Link>
        <div className="ml-auto">
          <CopyPromptButton global label="Copy docs prompt" />
        </div>
      </div>
      <StartHere />
      <DocsBrowse />
      <DocsIndex />
    </article>
  );
}
