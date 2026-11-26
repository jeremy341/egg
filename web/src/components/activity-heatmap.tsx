import { describeHeatmap, toWeeks, type Heatmap, type Level } from "@/lib/heatmap";
import { cn } from "@/lib/utils";

/**
 * A GitHub-style calendar of activity: one cell per UTC day, five intensity
 * levels. The grid is decoration for sighted readers; the sentence above it and
 * the list of active days are what assistive technology reads.
 */

const LEVEL_CLASS: Record<Level, string> = {
  0: "bg-muted",
  1: "bg-brand/25",
  2: "bg-brand/50",
  3: "bg-brand/75",
  4: "bg-brand",
};

const LEVEL_NAME: Record<Level, string> = {
  0: "none",
  1: "low",
  2: "medium",
  3: "high",
  4: "highest",
};

export function ActivityHeatmap({
  id,
  title,
  scope,
  heatmap,
  caption,
}: {
  id: string;
  title: string;
  /** Used in the summary, for example "project" or "account". */
  scope: string;
  heatmap: Heatmap;
  /** Shown under the title: what counts as activity. */
  caption: string;
}) {
  const summary = describeHeatmap(heatmap, scope);
  const weeks = toWeeks(heatmap.cells);
  const activeDays = heatmap.cells.filter((c) => c.count > 0);

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-3">
      <div>
        <h2 id={`${id}-title`} className="text-title-3 font-medium">
          {title}
        </h2>
        <p className="text-label text-muted-foreground">{caption}</p>
      </div>

      <p className="text-label">{summary}</p>

      <div className="overflow-x-auto pb-1">
        <div
          aria-hidden="true"
          className="grid grid-flow-col grid-rows-7 gap-[3px] w-max"
        >
          {weeks.map((week, w) =>
            week.map((cell, d) =>
              cell ? (
                <span
                  key={`${w}-${d}`}
                  title={`${cell.date}: ${cell.count} ${cell.count === 1 ? "event" : "events"}`}
                  className={cn("size-[11px] rounded-[2px]", LEVEL_CLASS[cell.level])}
                />
              ) : (
                <span key={`${w}-${d}`} className="size-[11px]" />
              )
            )
          )}
        </div>
      </div>

      <div aria-hidden="true" className="flex items-center gap-1.5 text-caption text-muted-foreground">
        <span>Less</span>
        {([0, 1, 2, 3, 4] as Level[]).map((level) => (
          <span key={level} className={cn("size-[11px] rounded-[2px]", LEVEL_CLASS[level])} />
        ))}
        <span>More</span>
      </div>

      <div className="sr-only">
        <h3>Days with activity</h3>
        {activeDays.length === 0 ? (
          <p>No days with activity in this window.</p>
        ) : (
          <ul>
            {activeDays.map((cell) => (
              <li key={cell.date}>{`${cell.date}: ${cell.count} ${cell.count === 1 ? "event" : "events"}, ${LEVEL_NAME[cell.level]} activity`}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
