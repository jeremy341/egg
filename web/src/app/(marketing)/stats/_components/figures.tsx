import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr";
import { formatCount, type Count } from "@/lib/stats-format";
import { cn } from "@/lib/utils";
import { CELL, CELLS } from "./layout";

/** A rounded figure. A bound reads as words, in smaller type, so it is never mistaken for a count. */
export function Figure({
  count,
  display,
}: {
  count: Count;
  display?: boolean;
}) {
  return "lessThan" in count ? (
    <span
      className={cn(
        "inline-flex items-center gap-2.5",
        display ? "text-stat" : "text-title-2",
      )}
    >
      {/* The hollow square is the chart legend's mark for "fewer than 10". */}
      <span
        aria-hidden="true"
        className="size-2.5 shrink-0 border border-current"
      />
      Fewer than {formatCount({ approx: count.lessThan })}
    </span>
  ) : (
    <span
      className={cn(
        "tabular",
        display
          ? "font-mono text-[clamp(3.5rem,9vw,6rem)] leading-none font-medium tracking-[-0.04em]"
          : "text-stat",
      )}
    >
      {formatCount(count)}
    </span>
  );
}

/** A whole number that is not a count (a percentage or a time). */
export function Value({ children }: { children: React.ReactNode }) {
  return <span className="tabular text-stat">{children}</span>;
}

/** The figure that stands in when the sample is too small. */
export function NotEnough() {
  return (
    <span className="text-title-2 text-muted-foreground">Not enough data</span>
  );
}

/** The unit of a figure, set beside it in the same baseline. */
export function Unit({
  children,
  large,
}: {
  children: React.ReactNode;
  large?: boolean;
}) {
  return (
    <span
      className={cn(
        "text-muted-foreground",
        large ? "text-title-2" : "text-label",
      )}
    >
      {children}
    </span>
  );
}

/**
 * One figure in a grid: label, then the figure with its unit, then what it counts.
 * Lives inside `Cells as="dl"`.
 */
export function Stat({
  label,
  unit,
  hint,
  children,
}: {
  label: string;
  unit: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className={CELL}>
      <dt className="text-body font-medium">{label}</dt>
      <dd className="mt-3 flex min-h-10 flex-wrap content-center items-baseline gap-x-2 gap-y-1">
        {children}
        <Unit>{unit}</Unit>
      </dd>
      <dd className="mt-2 text-caption text-muted-foreground">{hint}</dd>
    </div>
  );
}

/**
 * A ruled grid of cells. The wrapper clips the outer hairlines, so only the
 * lines between cells show and a short last row leaves no stray edge.
 */
export function Cells({
  as: Tag = "div",
  className,
  children,
}: {
  as?: "div" | "dl";
  className: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden">
      <Tag className={cn(CELLS, className)}>{children}</Tag>
    </div>
  );
}

/** Heading of a section and one plain sentence for the groups under it. */
export function SectionHead({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="p-5 sm:p-[30px]">
      <h2 id={id} className="font-pixel text-docs-h2">
        {title}
      </h2>
      <p className="mt-2 max-w-[56ch] text-body-lg text-muted-foreground">
        {children}
      </p>
    </div>
  );
}

/** Name of a group of figures, as a band across the top of it. */
export function GroupLabel({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  return (
    <h3
      id={id}
      className="border-b px-5 py-3 text-label font-medium sm:px-[30px]"
    >
      {children}
    </h3>
  );
}

/** Small label above a figure inside a block. Level 4 when it sits under a heading already. */
export function BlockLabel({
  id,
  level = 3,
  children,
}: {
  id?: string;
  level?: 3 | 4;
  children: React.ReactNode;
}) {
  const Heading = level === 4 ? "h4" : "h3";
  return (
    <Heading id={id} className="text-body font-medium">
      {children}
    </Heading>
  );
}

/** The figure line of a block: the figure, its unit or direction, at one baseline. */
export function FigureLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 flex min-h-10 flex-wrap items-baseline gap-x-3 gap-y-1">
      {children}
    </p>
  );
}

/**
 * The same facts as a chart, as a table, inside a closed disclosure.
 * Works from server and client components alike (no state of its own).
 */
export function TableDisclosure({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: [string, string];
  rows: [React.ReactNode, string][];
}) {
  return (
    <details className="disclosure mt-6 border-t pt-3">
      <summary className="touch-target -mx-1 w-fit items-center gap-1.5 rounded-sm px-1 py-1.5 text-label font-medium max-sm:min-h-10">
        <CaretRightIcon
          aria-hidden="true"
          className="disclosure-caret size-4"
        />
        Show the numbers as a table
      </summary>
      <div className="mt-2 max-h-64 overflow-auto border">
        <table className="w-full text-left text-label">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 bg-background-subtle text-muted-foreground">
            <tr>
              <th scope="col" className="w-1/2 px-3 py-2 font-medium">
                {head[0]}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {head[1]}
              </th>
            </tr>
          </thead>
          <tbody className="tabular">
            {rows.map(([label, value], i) => (
              <tr key={i} className="border-t">
                <th scope="row" className="px-3 py-1.5 font-normal">
                  {label}
                </th>
                <td className="px-3 py-1.5">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
