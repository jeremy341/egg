import { C } from "./prose";
import { CopyMarkdownButton } from "./copy-markdown";
import { CopyPromptButton } from "./copy-prompt";

/**
 * The two agent tools, in one place, as a live example on the "Docs for
 * agents" page. The prompt button builds its Claude and ChatGPT links in the
 * browser, so this panel stays a server component and only needs the page
 * whose Markdown the other button should copy.
 */
export function AgentPanel({ slug }: { slug: string }) {
  return (
    <div className="mt-8 border-y py-5">
      <p className="text-[13px] leading-5 font-medium tracking-[0.04em] text-muted-foreground uppercase">Try the tools</p>
      <div className="mt-3 divide-y">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-4">
          <div className="min-w-0">
            <p className="text-[15px] leading-6 font-medium text-foreground">Ask about the whole doc set</p>
            <p className="mt-0.5 text-[14px] leading-6 text-muted-foreground">
              Copies a prompt that points at <C>/llms.txt</C>. The arrow opens the same ask in Claude or ChatGPT.
            </p>
          </div>
          <CopyPromptButton global />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-4">
          <div className="min-w-0">
            <p className="text-[15px] leading-6 font-medium text-foreground">Take one page as text</p>
            <p className="mt-0.5 text-[14px] leading-6 text-muted-foreground">
              Copies <C>/docs/{slug}.md</C> to the clipboard. <C>Open .md</C> shows it in a tab.
            </p>
          </div>
          <CopyMarkdownButton slug={slug} />
        </div>
      </div>
    </div>
  );
}
