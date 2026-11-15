import { DocsIndex } from "./_components/docs-index";
import { StartHere } from "./_components/start-here";

export const metadata = {
  title: "Docs",
  description:
    "How Nest Deploy works: connecting a Nest server, deploying from GitHub, environment variables, domains, monitoring, analytics, security and limits.",
};

/** The docs home: where to start, then one index of every page, grouped like the sidebar. */
export default function DocsHome() {
  return (
    <article id="docs-article" tabIndex={-1} className="max-w-[1080px] outline-none">
      <h1 className="text-foreground text-[32px] leading-10 font-semibold tracking-[-0.025em] max-sm:text-[28px] max-sm:leading-9">
        Docs
      </h1>
      <p className="mt-[30px] max-w-[56ch] text-[19px] leading-[30px] text-muted-foreground">
        How to connect your Nest container, deploy to it and keep an eye on it. Every page is listed below with
        what it covers.
      </p>
      <StartHere />
      <DocsIndex />
    </article>
  );
}
