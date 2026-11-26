"use client";

import { useSyncExternalStore, useState } from "react";
import { CaretDownIcon } from "@phosphor-icons/react";
import { AgentMarks } from "@/components/agent-marks";
import { Swap } from "@/components/motion/swap";
import { toast } from "@/components/ui/toast";

/**
 * Orchard's CopyPromptButton pattern: a row of agent marks and a label that
 * copies a prompt pointing an agent at these docs. The marks are decorative;
 * the label carries the name. The origin is browser state, read with the store
 * hook so there is no setState-in-effect; before hydration the control is
 * disabled. The chevron previews the text and opens the same ask in Claude or
 * ChatGPT.
 *
 * Pass `slug` for a page-specific prompt, or `global` for the whole doc set.
 */
export function CopyPromptButton({
  slug,
  global = false,
  label = "Copy docs prompt",
}: {
  slug?: string;
  global?: boolean;
  label?: string;
}) {
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
    <span className="inline-flex items-center rounded-md border">
      <button
        type="button"
        onClick={copy}
        disabled={!prompt}
        aria-label={copied ? "Prompt copied" : label}
        className="touch-target inline-flex h-8 items-center gap-1.5 rounded-l-md px-2.5 font-medium text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-[var(--ds-gray-alpha-100)] hover:text-foreground disabled:opacity-50"
      >
        <AgentMarks />
        <Swap value={copied}>{copied ? "Prompt copied" : label}</Swap>
      </button>
      <details className="group relative">
        <summary
          aria-label="Preview prompt"
          title="Preview prompt"
          className="touch-target inline-flex h-8 w-7 cursor-pointer list-none items-center justify-center rounded-r-md text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-[var(--ds-gray-alpha-100)] hover:text-foreground [&::-webkit-details-marker]:hidden"
        >
          <CaretDownIcon aria-hidden="true" className="size-3.5 transition-transform group-open:rotate-180" />
        </summary>
        <div className="absolute right-0 top-full z-20 mt-1 w-80 max-w-[calc(100vw-2rem)] break-words rounded-md border bg-popover p-3 text-[12px] leading-5 shadow-lg">
          <p className="text-muted-foreground">{prompt || "Loading the prompt…"}</p>
          {claude ? (
            <a href={claude} target="_blank" rel="noopener noreferrer" className="mt-2 block rounded-sm py-1 text-[13px] text-foreground hover:underline">
              Open in Claude
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : null}
          {chatgpt ? (
            <a href={chatgpt} target="_blank" rel="noopener noreferrer" className="block rounded-sm py-1 text-[13px] text-foreground hover:underline">
              Open in ChatGPT
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : null}
        </div>
      </details>
    </span>
  );
}
