import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr";
import { STRIP_LEGEND, STRIP_TONE, dayDetail, dayLabel, stripSummary } from "@/app/status/[key]/strip";
import { cn } from "@/lib/utils";
import type { StripDay } from "@/server/status-page";

/**
 * The daily strip from the project status page: one cell per UTC day, the same
 * colours and legend, and the same days as text under a disclosure so nothing
 * lives only in a colour or a hover tooltip.
 */
export function DayStrip({ days, name }: { days: StripDay[]; name: string }) {
  if (days.length === 0) return null;
  return (
    <div>
      <div role="img" aria-label={`${name}. ${stripSummary(days, days.length)}`} className="flex h-6 gap-[3px]">
        {days.map((d) => (
          <span
            key={d.day}
            title={`${dayLabel(d.day)}: ${dayDetail(d)}`}
            className={cn("min-w-0 flex-1", STRIP_TONE[d.state])}
          />
        ))}
      </div>
      <div aria-hidden="true" className="tabular mt-2 flex justify-between text-caption text-muted-foreground">
        <span>{dayLabel(days[0].day)}</span>
        <span>Today</span>
      </div>
      <ul aria-label="Key" className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-caption text-muted-foreground">
        {STRIP_LEGEND.map((l) => (
          <li key={l.state} className="inline-flex items-center gap-2">
            <span aria-hidden="true" className={cn("size-2.5 shrink-0 ring-1 ring-inset ring-border", STRIP_TONE[l.state])} />
            {l.label}
          </li>
        ))}
      </ul>
      <details className="disclosure mt-4 border-t pt-3">
        <summary className="touch-target -mx-1 w-fit items-center gap-1.5 rounded-sm px-1 py-1.5 text-label font-medium max-sm:min-h-10">
          <CaretRightIcon aria-hidden="true" className="disclosure-caret size-4" />
          Show each day as text
        </summary>
        <div className="mt-2 max-h-64 overflow-auto border">
          <table className="w-full text-left text-label">
            <caption className="sr-only">{name}: each of the last {days.length} days, oldest first, in UTC</caption>
            <thead className="sticky top-0 bg-background-subtle text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Day
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  What happened
                </th>
              </tr>
            </thead>
            <tbody className="tabular">
              {days.map((d) => (
                <tr key={d.day} className="border-t">
                  <th scope="row" className="px-3 py-1.5 font-normal whitespace-nowrap">
                    <time dateTime={d.day}>{dayLabel(d.day)}</time>
                  </th>
                  <td className="px-3 py-1.5">{dayDetail(d)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
