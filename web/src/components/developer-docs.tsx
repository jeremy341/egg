"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRightIcon, CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { Swap } from "@/components/motion/swap";
import { Button } from "@/components/ui/button";
import { TOKEN_PLACEHOLDER, meExample, mcpUrl, openApiUrl } from "@/lib/developer";

/**
 * A Copy button. The announcement sits in its own live region so it is read
 * once. `onFail` runs when the browser refuses (no clipboard permission), so
 * the caller can select the text for a manual copy.
 */
export function CopyButton({
  text,
  label,
  onFail,
  className,
}: {
  text: string;
  /** Finishes the accessible name: "Copy the curl example". */
  label: string;
  onFail?: () => void;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  async function copy() {
    let next: "copied" | "failed" = "copied";
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      next = "failed";
      onFail?.();
    }
    setState(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), next === "copied" ? 1600 : 4000);
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={copy}
        aria-label={label}
        className={className}
      >
        <Swap value={state} className="inline-flex items-center gap-1">
          {state === "copied" ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
          {state === "copied" ? "Copied" : state === "failed" ? "Press Ctrl+C" : "Copy"}
        </Swap>
      </Button>
      <span aria-live="polite" className="sr-only">
        {state === "copied" ? "Copied" : state === "failed" ? "Could not copy. Select the text and copy it by hand." : ""}
      </span>
    </>
  );
}

/**
 * A block of code with a bar above it that names it and holds Copy. Long
 * lines wrap so the whole command is readable in a narrow column; Copy gives
 * the exact text.
 */
export function CodeBlock({ code, label, caption }: { code: string; label: string; caption?: string }) {
  return (
    <figure className="min-w-0 overflow-hidden rounded-md bg-[var(--code-bg)] shadow-border-base">
      <figcaption className="flex items-center justify-between gap-2 border-b py-1 pr-1 pl-3 text-caption text-muted-foreground">
        {caption ?? label}
        <CopyButton text={code} label={`Copy: ${label}`} />
      </figcaption>
      <pre className="p-3 font-mono text-[12.5px] leading-5 whitespace-pre-wrap [overflow-wrap:anywhere]">
        <code>{code}</code>
      </pre>
    </figure>
  );
}

/** A URL with break opportunities after each slash, so it wraps between path parts. */
function BreakableUrl({ url }: { url: string }) {
  const parts = url.split("/");
  return parts.map((part, i) => (
    <span key={i}>
      {part}
      {i < parts.length - 1 ? (
        <>
          /<wbr />
        </>
      ) : null}
    </span>
  ));
}

/** One address: its name, the URL in full, and Copy. */
function UrlRow({ name, url, label }: { name: string; url: string; label: string }) {
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-caption text-muted-foreground">{name}</p>
        <code className="mt-0.5 block font-mono text-[12.5px] leading-5 [overflow-wrap:anywhere]">
          <BreakableUrl url={url} />
        </code>
      </div>
      <CopyButton text={url} label={label} />
    </li>
  );
}

const DOCS_LINKS = [
  { href: "/docs/api", label: "Access tokens and the API" },
  { href: "/docs/api#api-examples", label: "Examples and the TypeScript client" },
  { href: "/docs/api#api-mcp", label: "Connect an AI agent" },
] as const;

/**
 * The developer page keeps only what someone needs while working: the
 * addresses, a first call, and links into the docs, where the full guide lives.
 * Its heading sits above the card, like the token groups beside it.
 */
export function DeveloperHub({ origin }: { origin: string }) {
  return (
    <div>
      <h2 id="hub-heading" className="mb-2 font-medium">
        Addresses and first call
      </h2>
      <div className="overflow-hidden rounded-lg bg-card shadow-border-small">
        <ul aria-label="Addresses" className="hairline-y">
          <UrlRow name="OpenAPI" url={openApiUrl(origin)} label="Copy the OpenAPI URL" />
          <UrlRow name="MCP" url={mcpUrl(origin)} label="Copy the MCP URL" />
        </ul>
        <section aria-labelledby="hub-first" className="border-t px-4 py-3">
          <h3 id="hub-first" className="text-caption text-muted-foreground">
            First call
          </h3>
          <p className="mt-0.5 mb-3 text-label">
            Call <code className="font-mono text-[12.5px]">/me</code> first. It needs no permission and tells you what
            the token can do. Replace <code className="font-mono text-[12.5px]">{TOKEN_PLACEHOLDER}</code> with your
            token.
          </p>
          <CodeBlock code={meExample(origin)} label="First call" caption="Terminal" />
        </section>
        <nav aria-label="Developer docs" className="border-t bg-background-subtle">
          <ul className="hairline-y">
            {DOCS_LINKS.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="flex min-h-10 items-center justify-between gap-3 px-4 py-2 text-label font-medium transition-colors duration-(--dur-fast) hover:bg-muted focus-visible:-outline-offset-2 max-sm:min-h-11"
                >
                  {l.label}
                  <ArrowRightIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
}
