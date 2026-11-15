import Link from "next/link";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/ssr";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { describeConnectionError } from "@/lib/connection-error";
import { cn } from "@/lib/utils";

/**
 * The one error shown when a container read fails. A connection problem is a
 * single plain sentence with Try again and a link to /connect, and the raw
 * message sits behind a disclosure. Any other message is shown as it is.
 */
export function ConnectionAlert({
  message,
  onRetry,
  retrying = false,
  note,
  className,
}: {
  message: string;
  onRetry: () => void;
  retrying?: boolean;
  /** One extra plain sentence, for example that older results are still on screen. */
  note?: string;
  className?: string;
}) {
  const view = describeConnectionError(message);
  return (
    <Alert tone="error" role="alert" title={view.summary} className={className}>
      {note ? <p className="text-muted-foreground">{note}</p> : null}
      {view.connection ? (
        <details className="mt-1 text-label text-muted-foreground">
          <summary className="inline-flex min-h-6 cursor-pointer items-center underline-offset-4 hover:underline max-sm:min-h-10">
            Show details
          </summary>
          <p className="mt-1 font-mono text-[13px] break-words">{view.detail}</p>
        </details>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
          <ArrowClockwiseIcon aria-hidden="true" className={cn(retrying && "animate-spin")} />
          Try again
        </Button>
        {view.connection ? (
          <Link href="/connect" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "px-2.5")}>
            Check your connection settings
          </Link>
        ) : null}
      </div>
    </Alert>
  );
}
