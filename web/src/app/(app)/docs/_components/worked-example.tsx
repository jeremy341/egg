import type { ReactNode } from "react";
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { CodeBlock } from "./code-block";
import { HeadingAnchor } from "./heading-anchor";
import { Callout, H2_CLASS, H3_CLASS, MEASURE, PROSE_TEXT, Table } from "./prose";

// The blocks a docs page is made of after its opening sentence:
//   Steps, then Limits, then WhatCanGoWrong, with a WorkedExample wherever a
//   reader should see the whole thing done once. Import them from here:
//
//   import { Callout, Limits, Steps, WhatCanGoWrong, WorkedExample } from "../_components/worked-example";
//
// Every block draws its own heading, so the page's heading levels never skip:
// the page title is the h1, `level={2}` blocks are h2 and `level={3}` blocks
// are h3. Each heading `id` must be unique on its page.

export { Callout };

type Level = 2 | 3;

/** One step. */
export type StepItem = {
  /** A short imperative title: "Add the key", "Press Test connection". */
  title: string;
  /** One paragraph. Say what to do and what it does. Optional when the title is enough. */
  children?: ReactNode;
  /** At most one code block: its caption ("Terminal", a file name, "In the dashboard") and exact text. */
  code?: { label: string; code: string };
  /** Or one exact path in the dashboard, in click order: ["Project", "Settings", "Domains"]. */
  path?: string[];
};

/** A heading at `level` with a link-to-this-heading control. */
function BlockHeading({
  id,
  title,
  level,
  className,
}: {
  id: string;
  title: string;
  level: Level;
  className?: string;
}) {
  const Tag = level === 2 ? "h2" : "h3";
  return (
    <div className={cn("group relative flex items-center gap-2 lg:block", className)}>
      <Tag id={id} tabIndex={-1} className={level === 2 ? H2_CLASS : H3_CLASS}>
        {title}
      </Tag>
      <HeadingAnchor id={id} title={title} />
    </div>
  );
}

const gapAbove = (level: Level) => (level === 2 ? "mt-[90px] max-sm:mt-[60px]" : "mt-[60px] max-sm:mt-[45px]");

/** A path through the dashboard: "Project, Settings, Domains", drawn as one line. */
function UiPath({ path }: { path: string[] }) {
  return (
    <p className="mt-[15px] flex flex-wrap items-center gap-x-1 text-[15px] leading-[30px] font-medium text-foreground">
      <span className="sr-only">In the dashboard: </span>
      {path.map((p, i) => (
        <span key={`${p}-${i}`} className="inline-flex items-center gap-1">
          {i > 0 ? (
            <>
              <CaretRightIcon aria-hidden="true" className="size-3 text-subtle-foreground" />
              <span className="sr-only">then </span>
            </>
          ) : null}
          {p}
        </span>
      ))}
    </p>
  );
}

/** The numbered list itself, without a heading. */
function StepList({ items, className }: { items: StepItem[]; className?: string }) {
  return (
    <ol className={cn("mt-[30px]", className)}>
      {items.map((s, i) => (
        <li key={s.title} className="grid grid-cols-[30px_minmax(0,1fr)] gap-x-[15px] pb-[30px] last:pb-0">
          {/* A lit cell holds the number: 24px square inset 3px in a 30px cell. */}
          <span
            aria-hidden="true"
            className="m-[3px] flex size-6 items-center justify-center bg-[var(--pixel-lit)] text-[13px] leading-none font-semibold text-background tabular-nums"
          >
            {i + 1}
          </span>
          <div className="min-w-0">
            <p className="text-[17px] leading-[30px] font-semibold text-foreground">
              <span className="sr-only">Step {i + 1}: </span>
              {s.title}
            </p>
            {s.children ? <div className={cn(MEASURE, PROSE_TEXT)}>{s.children}</div> : null}
            {s.path ? <UiPath path={s.path} /> : null}
            {s.code ? <CodeBlock label={s.code.label} code={s.code.code} /> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * The numbered steps of a task, under a heading (default "Steps").
 * - `id`: unique heading id on the page, for example "domains-steps".
 * - `items`: the steps, in order; each has a `title` and optionally a paragraph (`children`), one `code` block or one `path`.
 * - `title`: heading text; default "Steps".
 * - `level`: 2 for a page section (default), 3 when it sits inside another section.
 * - `quickReference`: optional code shown before the steps for a long sequence ("Quick reference").
 */
export function Steps({
  id,
  items,
  title = "Steps",
  level = 2,
  quickReference,
}: {
  id: string;
  items: StepItem[];
  title?: string;
  level?: Level;
  quickReference?: { label: string; code: string };
}) {
  return (
    <>
      <BlockHeading id={id} title={title} level={level} className={gapAbove(level)} />
      {quickReference ? (
        <>
          <p className={cn("mt-[30px]", MEASURE, PROSE_TEXT)}>The whole sequence at a glance:</p>
          <CodeBlock label={quickReference.label} code={quickReference.code} />
        </>
      ) : null}
      <StepList items={items} />
    </>
  );
}

/** One limit. */
export type LimitItem = {
  /** What is limited: "Releases kept per project". */
  name: ReactNode;
  /** The number or value, read from the code that enforces it: "5". */
  value: ReactNode;
  /** What happens when the limit is reached. */
  atLimit: ReactNode;
};

/**
 * The limits that apply to the feature, as a table of name, value and what happens at it.
 * - `id`: unique heading id on the page.
 * - `items`: one row per limit.
 * - `title`: heading text; default "Limits".
 * - `level`: 2 (default) or 3.
 * - `children`: optional sentence above the table.
 */
export function Limits({
  id,
  items,
  title = "Limits",
  level = 2,
  children,
}: {
  id: string;
  items: LimitItem[];
  title?: string;
  level?: Level;
  children?: ReactNode;
}) {
  return (
    <>
      <BlockHeading id={id} title={title} level={level} className={gapAbove(level)} />
      {children ? <p className={cn("mt-[30px]", MEASURE, PROSE_TEXT)}>{children}</p> : null}
      <Table
        caption={title}
        head={["Limit", "Value", "What happens at it"]}
        rows={items.map((l) => [l.name, l.value, l.atLimit])}
      />
    </>
  );
}

/** One failure. */
export type ProblemItem = {
  /** What the reader sees. A string is shown as code: put the exact message or state text here. */
  symptom: ReactNode;
  /** What it means and how to fix it, in one or two sentences. */
  fix: ReactNode;
};

/**
 * Each failure the feature can report: the exact message or state, then the fix.
 * - `id`: unique heading id on the page.
 * - `items`: the failures, most likely first.
 * - `title`: heading text; default "What can go wrong".
 * - `level`: 2 (default) or 3.
 */
export function WhatCanGoWrong({
  id,
  items,
  title = "What can go wrong",
  level = 2,
}: {
  id: string;
  items: ProblemItem[];
  title?: string;
  level?: Level;
}) {
  return (
    <>
      <BlockHeading id={id} title={title} level={level} className={gapAbove(level)} />
      <ul className="mt-[30px] divide-y overflow-hidden rounded-md border bg-background">
        {items.map((p, i) => (
          <li key={i} className="px-4 py-3 max-sm:px-3">
            <p className="text-[15px] leading-[30px] font-semibold text-foreground">
              {typeof p.symptom === "string" ? (
                <code className="rounded-[3px] bg-[var(--ds-gray-100)] px-1.5 py-px font-mono text-[14px] shadow-[inset_0_0_0_1px_var(--ds-gray-alpha-200)] [overflow-wrap:anywhere]">
                  {p.symptom}
                </code>
              ) : (
                p.symptom
              )}
            </p>
            <div className={cn(MEASURE, "text-[16px] leading-[30px] text-reading")}>{p.fix}</div>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * A complete worked example, titled "Example: ...": what you start with, what to do, what you see.
 * - `id`: unique heading id on the page.
 * - `title`: what the example achieves: "Put pixel-garden online".
 * - `given`: what the reader starts with, using sample names (a repository, a token name).
 * - `steps`: the "Do" part; same items as `Steps`.
 * - `result`: what the reader sees, quoting the interface text exactly.
 * - `label`: the marker word; "Example" (default) or "Try it".
 * - `level`: 3 (default, inside a page section) or 2.
 */
export function WorkedExample({
  id,
  title,
  given,
  steps,
  result,
  label = "Example",
  level = 3,
}: {
  id: string;
  title: string;
  given: ReactNode;
  steps: StepItem[];
  result: ReactNode;
  label?: "Example" | "Try it";
  level?: Level;
}) {
  const Part = level === 2 ? "h3" : "h4";
  const part = "text-[13px] leading-[30px] font-semibold text-muted-foreground";
  return (
    <section aria-labelledby={id} className={gapAbove(level)}>
      <BlockHeading id={id} title={`${label}: ${title}`} level={level} />
      <div className="mt-[15px] divide-y overflow-hidden rounded-md border bg-background">
        <div className="px-4 py-3 max-sm:px-3">
          <Part className={part}>Given</Part>
          <div className={cn(MEASURE, PROSE_TEXT)}>{given}</div>
        </div>
        <div className="px-4 py-3 max-sm:px-3">
          <Part className={part}>Do</Part>
          <StepList items={steps} className="mt-0" />
        </div>
        <div className="px-4 py-3 max-sm:px-3">
          <Part className={part}>Result</Part>
          <div className={cn(MEASURE, PROSE_TEXT)}>{result}</div>
        </div>
      </div>
    </section>
  );
}
