"use client";

import { useEffect, useRef } from "react";
import { ArrowClockwiseIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * What the error boundaries show instead of the framework fallback: one plain
 * sentence, Try again, and a way back to Projects. `fullPage` centres it in the
 * viewport for global-error, which renders outside the dashboard frame.
 */
export function AppError({
  onRetry,
  digest,
  fullPage = false,
}: {
  onRetry: () => void;
  digest?: string;
  fullPage?: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);

  // Tell keyboard and screen reader users the page changed under them.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-4 text-center",
        fullPage ? "min-h-dvh" : "min-h-[50dvh] py-10"
      )}
    >
      <div className="w-full max-w-[44ch] rounded-lg bg-card p-6 shadow-border-small">
        <WarningCircleIcon aria-hidden="true" className="mx-auto size-6 text-destructive" />
        <h1 ref={heading} tabIndex={-1} className="mt-3 text-title-2 outline-none">
          Something went wrong loading this page
        </h1>
        <p className="mt-1.5 text-muted-foreground">
          This is on our side, not yours. Try again, or go back to your projects.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button type="button" onClick={onRetry} className="px-3 max-sm:flex-1">
            <ArrowClockwiseIcon aria-hidden="true" />
            Try again
          </Button>
          {/* A plain link on purpose: if the router is what broke, a full load still works. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/projects"
            className={cn(buttonVariants({ variant: "outline" }), "px-3 max-sm:flex-1")}
          >
            Projects
          </a>
        </div>
        {digest ? (
          <p className="mt-4 text-label text-muted-foreground">
            Reference <span className="font-mono text-[13px]">{digest}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
