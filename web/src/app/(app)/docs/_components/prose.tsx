import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { CheckCircleIcon, InfoIcon, WarningIcon } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { sectionTitle, subsectionTitle, headingId } from "../_data/nav";
import { HeadingAnchor } from "./heading-anchor";

// Server components only. The two client pieces (the heading anchor and the
// code block's copy button) are imported where they are used.
//
// Vertical rhythm: prose is 17px on a 30px line, and every gap between blocks
// is a whole number of 30px rows, so the page grid's hairlines fall between
// lines of text instead of through them.

/** The reading style: 17px on a 30px line, in the reading ink. */
export const PROSE_TEXT = "text-[17px] leading-[30px] text-reading";

/**
 * The reading measure: 33em of 17px text is about 560px, which is about 68
 * characters of this face a line. (`68ch` would be wider, because a "0" is
 * wider than the average letter.) Code, tables, steps and callouts use the
 * whole column, which is 720px at most.
 */
export const MEASURE = "max-w-[33em]";

/**
 * Headings. The title and the page sections are in the pixel face (the
 * layout puts the font on the docs); `h3` and below are in the body face, so a
 * long page stays readable.
 */
export const H1_CLASS =
  "font-pixel text-foreground outline-none text-[40px] leading-[60px] font-medium max-sm:text-[28px] max-sm:leading-9";
export const H2_CLASS =
  "font-pixel min-w-0 scroll-mt-32 text-foreground outline-none text-[26px] leading-[30px] font-medium max-sm:text-[22px]";
export const H3_CLASS = "min-w-0 scroll-mt-32 text-[19px] leading-[30px] font-semibold text-foreground outline-none";

/** Inline code. */
export function C({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-[3px] bg-[var(--ds-gray-100)] px-1 py-px font-mono text-[0.85em] text-foreground shadow-[inset_0_0_0_1px_var(--ds-gray-alpha-200)] [overflow-wrap:anywhere]">
      {children}
    </code>
  );
}

/** Bold lead-in for a list item. */
export function B({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-foreground">{children}</strong>;
}

/** One paragraph, at most 68 characters wide. */
export function P({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("mt-[30px]", MEASURE, PROSE_TEXT, className)}>{children}</p>;
}

const linkClass = "link font-medium text-foreground";

/** A link to another page of this site. */
export function InternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={linkClass}>
      {children}
    </Link>
  );
}

/** A link that leaves the site. */
export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={linkClass}>
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/**
 * Heading row. The anchor sits beside the heading rather than inside it, so
 * the heading's accessible name stays just its title.
 */
function HeadingRow({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("group relative flex items-center gap-2 lg:block", className)}>{children}</div>;
}

/**
 * One whole docs page. Its title is the page's only `h1`; the optional `intro`
 * is the one sentence on what the page covers.
 * - `id`: the page id from `_data/nav.ts` (the title is read from there).
 * - `intro`: the sentence under the title.
 */
export function Section({
  id,
  intro,
  children,
}: {
  id: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  const title = sectionTitle(id);
  const hid = headingId(id);
  return (
    <section id={id} aria-labelledby={hid}>
      <h1 id={hid} tabIndex={-1} className={H1_CLASS}>
        {title}
      </h1>
      {intro ? <p className="mt-[15px] max-w-[30em] text-[19px] leading-[30px] text-muted-foreground">{intro}</p> : null}
      {children}
    </section>
  );
}

type HeadingProps = {
  /** Unique on the page; it is the link target and what "On this page" points at. */
  id: string;
  /** The heading text. Leave it out only for an id that is listed in `_data/nav.ts`. */
  title?: string;
};

function resolveTitle(id: string, title?: string): string {
  return title ?? subsectionTitle(id);
}

/** A page section: an `h2`, in the pixel face. Sections are what "On this page" lists first. */
export function H2({ id, title }: HeadingProps) {
  const text = resolveTitle(id, title);
  return (
    <HeadingRow className="mt-[90px] max-sm:mt-[60px]">
      <h2 id={id} tabIndex={-1} className={H2_CLASS}>
        {text}
      </h2>
      <HeadingAnchor id={id} title={text} />
    </HeadingRow>
  );
}

/**
 * A subsection inside a page section: an `h3`, in the body face.
 *
 * For old pages: `<H3 id="..." />` with no `title` and an id from `_data/nav.ts`
 * is the earlier form of a page section, so it still draws an `h2`. Use `H2`
 * for a page section and give `H3` a `title`.
 */
export function H3({ id, title }: HeadingProps) {
  if (title === undefined) return <H2 id={id} />;
  return (
    <HeadingRow className="mt-[60px] max-sm:mt-[45px]">
      <h3 id={id} tabIndex={-1} className={H3_CLASS}>
        {title}
      </h3>
      <HeadingAnchor id={id} title={title} />
    </HeadingRow>
  );
}

const bullets =
  "[&>li]:relative [&>li]:pl-5 [&>li]:before:absolute [&>li]:before:top-[12px] [&>li]:before:left-0 [&>li]:before:size-[6px] [&>li]:before:bg-[var(--subtle-foreground)] [&>li]:before:content-['']";

/** A bulleted list (square bullets), or a numbered one with `ordered`. */
export function List({ children, ordered }: { children: ReactNode; ordered?: boolean }) {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag
      className={cn(
        "mt-[30px]",
        MEASURE,
        PROSE_TEXT,
        ordered ? "list-decimal pl-6 marker:font-medium marker:text-subtle-foreground marker:tabular-nums" : bullets
      )}
    >
      {children}
    </Tag>
  );
}

/**
 * Soft edge shadows that appear only on a side that has more to scroll to
 * (the "local" layers hide the "scroll" layers once you reach that end).
 */
const SCROLL_SHADOW: CSSProperties = {
  background: [
    "linear-gradient(to right, var(--background) 30%, transparent) 0 0 / 32px 100% no-repeat local",
    "linear-gradient(to left, var(--background) 30%, transparent) 100% 0 / 32px 100% no-repeat local",
    "linear-gradient(to right, color-mix(in oklab, var(--foreground) 14%, transparent), transparent) 0 0 / 14px 100% no-repeat scroll",
    "linear-gradient(to left, color-mix(in oklab, var(--foreground) 14%, transparent), transparent) 100% 0 / 14px 100% no-repeat scroll",
    "var(--background)",
  ].join(", "),
};

/**
 * A data table. It fills the column and scrolls inside its own frame.
 * - `head`: the column titles.
 * - `rows`: one array of cells per row.
 * - `caption`: the accessible name of the scrollable region (the nearest heading).
 */
export function Table({
  head,
  rows,
  caption,
}: {
  head: string[];
  rows: ReactNode[][];
  caption: string;
}) {
  const wide = head.length >= 3;
  return (
    <div
      role="region"
      aria-label={caption}
      tabIndex={0}
      style={SCROLL_SHADOW}
      className="mt-[30px] overflow-x-auto border bg-background"
    >
      <table className={cn("w-full border-collapse text-left text-docs-small", wide && "min-w-[520px]")}>
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-background-subtle">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="border-b px-4 py-2.5 text-[13px] font-medium text-muted-foreground max-sm:px-3">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td
                  key={j}
                  className={cn(
                    // Code in a cell breaks at spaces, never in the middle of a name.
                    "px-4 py-3 align-top max-sm:px-3 [&_code]:[overflow-wrap:normal]",
                    j === 0 ? "font-medium text-foreground sm:whitespace-nowrap" : "text-reading",
                    j === 0 && !wide && "sm:w-[34%]",
                    j === 0 && wide && "sm:w-[28%]"
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TONES = {
  note: { token: "note", Icon: InfoIcon, label: "Note" },
  tip: { token: "success", Icon: CheckCircleIcon, label: "Tip" },
  warning: { token: "warning", Icon: WarningIcon, label: "Warning" },
} as const;

const iconClass = {
  note: "text-[var(--tone-note-icon)]",
  success: "text-[var(--tone-success-icon)]",
  warning: "text-[var(--tone-warning-icon)]",
} as const;

/**
 * A short aside that sits in the text.
 * - `tone`: "note" (extra context), "tip" (a faster way) or "warning" (something can break or be lost).
 * - `title`: one short line, in sentence case; it names the point.
 * - `children`: one or two sentences.
 */
export function Callout({
  tone,
  title,
  children,
}: {
  tone: keyof typeof TONES;
  title: string;
  children: ReactNode;
}) {
  const { token, Icon, label } = TONES[tone];
  return (
    <div role="note" aria-label={label} className="mt-[30px] flex gap-3 border bg-background p-4">
      <Icon aria-hidden="true" weight="regular" className={cn("mt-[5px] size-4 shrink-0", iconClass[token])} />
      <div className="min-w-0">
        <p className="text-[15px] leading-6 font-semibold text-foreground">{title}</p>
        <div className="mt-1 text-docs-small text-foreground/85">{children}</div>
      </div>
    </div>
  );
}
