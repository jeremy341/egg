import { DocsIndex } from "./_components/docs-index";
import { H1_CLASS } from "./_components/prose";
import { StartHere } from "./_components/start-here";

export const metadata = {
  title: "Docs",
  description:
    "How Nest Deploy works: connecting a Nest server, deploying from GitHub, environment variables, domains, monitoring, analytics, security and limits.",
};

/** The docs home: where to start, then one index of every page, grouped like the sidebar. */
export default function DocsHome() {
  return (
    <article id="docs-article" tabIndex={-1} className="max-w-[960px] outline-none">
      <h1 className={H1_CLASS}>Docs</h1>
      <p className="mt-[15px] max-w-[30em] text-[19px] leading-[30px] text-muted-foreground">
        How to connect your Nest container, deploy to it and keep an eye on it. New here? Read how it works, then the
        quick start. Every other page is listed below with what it covers.
      </p>
      <StartHere />
      <DocsIndex />
    </article>
  );
}
