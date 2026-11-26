import type { RightSize } from "@/server/right-size";

/**
 * A read-only resource suggestion from the monitor's own samples. Nothing is
 * applied from here: the owner reads the number and changes the app if they
 * want to.
 */
export function RightSizeCard({ suggestion }: { suggestion: RightSize }) {
  return (
    <section aria-labelledby="right-size-heading" className="rounded-lg bg-card p-4 shadow-border-small">
      <h2 id="right-size-heading" className="text-title-3">
        Right-sizing suggestion
      </h2>
      {suggestion.status === "not_enough_history" ? (
        <p className="mt-2 text-label text-muted-foreground">
          Need {suggestion.neededDays} days of readings before a suggestion. Have {suggestion.days}.
        </p>
      ) : (
        <>
          <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
            {suggestion.memoryMb !== null ? (
              <div>
                <dt className="text-label text-muted-foreground">Memory</dt>
                <dd className="tabular font-mono text-[13px]">{suggestion.memoryMb} MB</dd>
              </div>
            ) : null}
            {suggestion.cpuMillicores !== null ? (
              <div>
                <dt className="text-label text-muted-foreground">CPU</dt>
                <dd className="tabular font-mono text-[13px]">{suggestion.cpuMillicores}m</dd>
              </div>
            ) : null}
            {suggestion.memoryMb === null && suggestion.cpuMillicores === null ? (
              <dt className="text-label text-muted-foreground">No usable readings yet.</dt>
            ) : null}
          </dl>
          <p className="mt-2 text-label text-muted-foreground">
            Based on {suggestion.days} days of readings. A suggestion only — Egg does not change your app&apos;s size.
          </p>
        </>
      )}
    </section>
  );
}
