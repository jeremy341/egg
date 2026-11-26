import {
  CheckCircleIcon,
  CircleDashedIcon,
  MinusCircleIcon,
  ProhibitIcon,
  XCircleIcon,
} from "@phosphor-icons/react/dist/ssr";
import { CommitLink } from "@/components/commit-link";
import { LocalTime } from "@/components/local-time";
import { Alert } from "@/components/ui/alert";
import { PixelLoader } from "@/components/ui/pixel-loader";
import { formatStageDuration, type Timeline, type TimelineStage, type TimelineStatus } from "@/lib/deploy-timeline";
import { cn } from "@/lib/utils";

/** What a screen reader hears after the stage name. The shape of the mark carries it for everyone else. */
const SPOKEN: Record<TimelineStatus, string> = {
  done: "done",
  current: "in progress",
  failed: "failed",
  canceled: "canceled",
  skipped: "skipped",
  pending: "waiting",
};

/** Shown beside the name for the states that need a word. A finished stage shows its time instead. */
const SHOWN: Partial<Record<TimelineStatus, string>> = {
  current: "In progress",
  failed: "Failed",
  canceled: "Canceled",
  pending: "Waiting",
};

function Mark({ status }: { status: TimelineStatus }) {
  const common = "size-5 shrink-0";
  switch (status) {
    case "done":
      return <CheckCircleIcon aria-hidden="true" weight="fill" className={cn(common, "text-brand-text")} />;
    case "current":
      return (
        <span aria-hidden="true" className={cn(common, "inline-flex items-center justify-center text-[var(--status-building)]")}>
          <PixelLoader size="md" />
        </span>
      );
    case "failed":
      return <XCircleIcon aria-hidden="true" weight="fill" className={cn(common, "text-[var(--status-error)]")} />;
    case "canceled":
      return <ProhibitIcon aria-hidden="true" weight="bold" className={cn(common, "text-muted-foreground")} />;
    case "skipped":
      return <MinusCircleIcon aria-hidden="true" className={cn(common, "text-subtle-foreground")} />;
    default:
      return <CircleDashedIcon aria-hidden="true" className={cn(common, "text-subtle-foreground")} />;
  }
}

function Step({ stage, last }: { stage: TimelineStage; last: boolean }) {
  const shown = SHOWN[stage.status];
  const duration = formatStageDuration(stage.durationMs);
  const quiet = stage.status === "skipped" || stage.status === "pending";
  return (
    <li aria-current={stage.status === "current" ? "step" : undefined} className="flex gap-3" data-status={stage.status}>
      <div className="flex flex-col items-center">
        <Mark status={stage.status} />
        {last ? null : <span aria-hidden="true" className="my-1 w-px flex-1 bg-border" />}
      </div>
      <div className={cn("min-w-0 flex-1", last ? "pb-0" : "pb-4")}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className={cn("font-medium tracking-[-0.02em]", quiet && "font-normal text-muted-foreground")}>
              {stage.label}
              <span className="sr-only">, {SPOKEN[stage.status]}</span>
            </span>
            {shown ? (
              <span
                aria-hidden="true"
                className={cn(
                  "text-caption",
                  stage.status === "failed" ? "text-[var(--status-error)]" : "text-muted-foreground"
                )}
              >
                {shown}
              </span>
            ) : null}
          </p>
          {stage.at || duration ? (
            <p className="tabular text-label text-muted-foreground">
              {stage.at ? (
                <>
                  <span className="sr-only">at </span>
                  <LocalTime iso={stage.at} />
                </>
              ) : null}
              {stage.at && duration ? <span aria-hidden="true"> · </span> : null}
              {duration ? (
                <span>
                  <span className="sr-only">{stage.at ? ", took " : "took "}</span>
                  {duration}
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
        {stage.detail ? <p className="mt-0.5 text-label break-words text-muted-foreground">{stage.detail}</p> : null}
      </div>
    </li>
  );
}

/**
 * Where a deployment is, stage by stage, with the commit and the time each stage was reached. On
 * a failure it leads with one message that says what went wrong and what to do. The page refreshes
 * itself while a deployment runs, so the polite live region below changes only when the stage does.
 */
export function DeploymentTimeline({
  timeline,
  repo,
  sha,
}: {
  timeline: Timeline;
  repo: string | null;
  sha: string | null;
}) {
  const { failure, canceledWhy } = timeline;
  return (
    <div className="space-y-4">
      {failure ? (
        <div data-tour="error-summary">
          <Alert tone="error" title="This deployment failed">
            <p>{failure.message}</p>
            {failure.note ? <p className="mt-1 text-muted-foreground">{failure.note}</p> : null}
            {failure.recorded && failure.recorded !== failure.message ? (
              <p className="mt-2 text-caption break-words text-muted-foreground">
                What Egg recorded: <span className="font-mono">{failure.recorded}</span>
              </p>
            ) : null}
          </Alert>
        </div>
      ) : null}
      {timeline.outcome === "canceled" && canceledWhy ? <Alert tone="note">{canceledWhy}</Alert> : null}

      <section aria-labelledby="timeline-heading" className="overflow-hidden rounded-lg bg-card shadow-border-small">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b px-4 py-3">
          <h2 id="timeline-heading" className="text-title-3">
            Timeline
          </h2>
          <p className="text-label text-muted-foreground">
            Commit{" "}
            <CommitLink repo={repo} sha={sha} fallback="not read yet" className="font-mono text-[13px] text-foreground" />
          </p>
        </div>
        <ol className="p-4" aria-labelledby="timeline-heading">
          {timeline.stages.map((stage, i) => (
            <Step key={stage.key} stage={stage} last={i === timeline.stages.length - 1} />
          ))}
        </ol>
        <p role="status" aria-live="polite" className="sr-only">
          {timeline.summary}
        </p>
      </section>
    </div>
  );
}
