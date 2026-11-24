import { cn } from "@/lib/utils";
import { CopyPromptButton } from "./_components/copy-prompt";
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
    <article id="docs-article" data-docs-page="index" data-docs-body tabIndex={-1} className={cn(ARTICLE, "outline-none")}>
      <PageHeader
        tag="Documentation"
        title="Docs"
        titleId="docs-h"
        lead="How to connect your Nest container, deploy to it and keep an eye on it. New here? Read how it works, then the quick start. Every other page is listed below with what it covers."
      />
      <div className="my-6 flex justify-end">
        <CopyPromptButton global label="Copy docs prompt" />
      </div>
      <StartHere />
      <DocsIndex />
    </article>
  );
}
