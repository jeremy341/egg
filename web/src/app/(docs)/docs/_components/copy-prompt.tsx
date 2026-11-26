"use client";

import { useSyncExternalStore, useState } from "react";
import { CaretDownIcon, CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { toast } from "@/components/ui/toast";

/**
 * Copies a prompt that points an agent at Egg's docs. Orchard puts this next
 * to the page title; we put it in the same action row as "Copy as Markdown".
 * The copied text is plain so it can be pasted anywhere, and the menu opens
 * the same ask in Claude or ChatGPT as a one click shortcut.
 *
 * Pass `slug` for a page-specific prompt, or `global` for the whole doc set.
 * The prompt needs an absolute address, which the server cannot know behind
 * a proxy, so it is built in the browser from window.location.origin.
 */
export function CopyPromptButton({
  slug,
  global = false,
  label = "Copy prompt",
}: {
  slug?: string;
  global?: boolean;
  label?: string;
}) {
  // The origin is browser state, read with the store hook so there is no
  // setState-in-effect. On the server it is empty and the control is disabled.
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => ""
  );
  const prompt = global
    ? `Read the Egg docs at ${origin}/llms.txt and use them to help me. Fetch the pages you need before you answer, and link the pages you used.`
    : `Read ${origin}/docs/${slug}.md and answer my questions about it.`;
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      toast.success("Prompt copied");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy the prompt");
    }
  }

  const ask = prompt ? encodeURIComponent(prompt) : "";
  const claude = ask ? `https://claude.ai/new?q=${ask}` : null;
  const chatgpt = ask ? `https://chatgpt.com/?q=${ask}` : null;

  return (
    <div className="inline-flex items-center rounded-md border">
      <button
        type="button"
        onClick={copy}
        disabled={!prompt}
        aria-label={copied ? "Prompt copied" : label}
        className="touch-target inline-flex h-8 items-center gap-1.5 rounded-l-md px-2.5 font-medium text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-[var(--ds-gray-alpha-100)] hover:text-foreground disabled:opacity-50"
      >
        {copied ? <CheckIcon aria-hidden="true" className="size-3.5" /> : <CopyIcon aria-hidden="true" className="size-3.5" />}
        {copied ? "Prompt copied" : label}
      </button>
      <details className="group relative">
        <summary
          aria-label="More ways to open this prompt"
          title="More ways to open this prompt"
          className="touch-target inline-flex h-8 w-7 cursor-pointer list-none items-center justify-center rounded-r-md text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-[var(--ds-gray-alpha-100)] hover:text-foreground [&::-webkit-details-marker]:hidden"
        >
          <CaretDownIcon aria-hidden="true" className="size-3.5 transition-transform group-open:rotate-180" />
        </summary>
        <div className="absolute right-0 top-full z-20 mt-1 w-80 rounded-md border bg-popover p-1 shadow-lg">
          <p className="px-2 py-1.5 text-[12px] leading-snug text-muted-foreground break-words">{prompt}</p>
          {claude ? (
            <a href={claude} target="_blank" rel="noopener noreferrer" className="block rounded-sm px-2 py-1.5 text-[13px] hover:bg-[var(--ds-gray-alpha-100)]">
              Open in Claude
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : null}
          {chatgpt ? (
            <a href={chatgpt} target="_blank" rel="noopener noreferrer" className="block rounded-sm px-2 py-1.5 text-[13px] hover:bg-[var(--ds-gray-alpha-100)]">
              Open in ChatGPT
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : null}
        </div>
      </details>
    </div>
  );
}
