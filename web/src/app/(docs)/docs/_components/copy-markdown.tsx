"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { toast } from "@/components/ui/toast";

/**
 * Copies this page's Markdown (from /docs/<slug>.md) to the clipboard, for
 * pasting into an assistant or a note. The text is fetched on press, so the
 * page itself does not carry it. If the copy fails, the link still opens the
 * Markdown in its own tab.
 */
export function CopyMarkdownButton({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  const href = `/docs/${slug}.md`;

  async function copy() {
    try {
      const res = await fetch(href);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await navigator.clipboard.writeText(await res.text());
      setCopied(true);
      toast.success("Markdown copied");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy. Open the Markdown instead.");
    }
  }

  return (
    <div className="mb-6 flex items-center justify-end gap-2 text-[13px]">
      <button
        type="button"
        onClick={copy}
        className="touch-target inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 font-medium text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-[var(--ds-gray-alpha-100)] hover:text-foreground"
      >
        {copied ? <CheckIcon aria-hidden="true" className="size-3.5" /> : <CopyIcon aria-hidden="true" className="size-3.5" />}
        Copy as Markdown
      </button>
      <a href={href} className="link text-muted-foreground hover:text-foreground">
        Open .md
      </a>
    </div>
  );
}
