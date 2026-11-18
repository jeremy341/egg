import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { CheckCircleIcon, InfoIcon, WarningIcon } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { DOCS_SECTIONS, groupOf, sectionTitle, subsectionTitle, headingId } from "../_data/nav";
import { HeadingAnchor } from "./heading-anchor";

// Server components only. The two client pieces (the heading anchor and the
// code block's copy button) are imported where they are used.
//
// Vertical rhythm, on a 4px grid, taken from the Loadout docs: prose is 17px
// on a 28px line. A paragraph or list follows the one before it by 20px, a
// code block, table or callout by 32px, a subsection heading by 40px and a
// section heading by 64px. Spacing is the only divider inside a page; the one
// hairline sits under the header.

/** The reading style: 17px on a 28px line, in the reading ink. */
export const PROSE_TEXT = "text-[17px] leading-[28px] text-reading";

/**
 * The reading measure: 36em of 16px text is 576px, about 72 characters of this
 * face a line. (`72ch` would be wider, because a "0" is wider than the average
 * letter.) Code, tables, steps and callouts use the whole column, which is
 * 680px at most.
 */
export const MEASURE = "max-w-[40em] min-[1536px]:max-w-[46em]";

/**
 * Headings. The title and the page sections are in the pixel face (the
 * layout puts the font on the docs); `h3` and below are in the body face, so a
 * long page stays readable.
 */
export const H1_CLASS =
  "font-pixel text-left text-foreground outline-none text-[40px] leading-[44px] font-medium max-sm:text-[30px] max-sm:leading-9";
export const H2_CLASS =
  "font-pixel min-w-0 scroll-mt-32 text-left text-foreground outline-none text-[28px] leading-9 font-medium max-sm:text-[24px] max-sm:leading-8";
export const H3_CLASS = "min-w-0 scroll-mt-32 text-left text-[18px] leading-7 font-semibold tracking-[-0.015em] text-foreground outline-none";

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

/** One paragraph, at most 72 characters wide. */
export function P({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("mt-5 text-left", MEASURE, PROSE_TEXT, className)}>{children}</p>;
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
 * The top of every page: a small tag naming the group the page belongs to
 * (with where the page falls in the reading order beside it), the title, one
 * line on what it covers, and the one hairline that ends the header. Spacing
 * follows the Loadout docs: 14px under the tag, 20px between the title and the lead.
 * - `tag`: the group name, drawn as a small uppercase pill.
 * - `position`: where the page falls in the reading order.
 */
export function PageHeader({
  tag,
  position,
  title,
  titleId,
  lead,
}: {
  tag: string;
  position?: string;
  title: string;
  titleId: string;
  lead?: ReactNode;
}) {
  return (
    <header className="border-b pb-8 text-left">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-block rounded-full border px-2.5 py-0.5 text-[12px] leading-4 font-medium tracking-[0.08em] text-muted-foreground uppercase">
          {tag}
        </span>
        {position ? <p className="text-[13px] leading-5 text-subtle-foreground tabular-nums">{position}</p> : null}
      </div>
      <h1 id={titleId} tabIndex={-1} className={cn(H1_CLASS, "mt-3.5")}>
        {title}
      </h1>
      {lead ? <p className="mt-5 max-w-[36em] text-[19px] leading-[30px] text-muted-foreground max-sm:text-[17px] max-sm:leading-7">{lead}</p> : null}
    </header>
  );
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
  const at = DOCS_SECTIONS.findIndex((s) => s.id === id) + 1;
  return (
    <section id={id} aria-labelledby={hid}>
      <PageHeader
        tag={groupOf(id) ?? "Docs"}
        position={at > 0 ? `Page ${at} of ${DOCS_SECTIONS.length}` : undefined}
        title={title}
        titleId={hid}
        lead={intro}
      />
      {/* The header ends the page's top; the first block starts the body. */}
      <div className="mt-10 [&>:first-child]:mt-0">{children}</div>
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
    <HeadingRow className="mt-16 max-sm:mt-12">
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
    <HeadingRow className="mt-10 max-sm:mt-8">
      <h3 id={id} tabIndex={-1} className={H3_CLASS}>
        {title}
      </h3>
      <HeadingAnchor id={id} title={title} />
    </HeadingRow>
  );
}

const bullets =
  "[&>li]:relative [&>li]:pl-5 [&>li]:before:absolute [&>li]:before:top-[10px] [&>li]:before:left-0 [&>li]:before:size-[5px] [&>li]:before:bg-[var(--subtle-foreground)] [&>li]:before:content-['']";

/** A bulleted list (square bullets), or a numbered one with `ordered`. */
export function List({ children, ordered }: { children: ReactNode; ordered?: boolean }) {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag
      className={cn(
        "mt-5 space-y-2.5 text-left",
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
      className="relative mt-8 overflow-x-auto border-y bg-background"
    >
      <table className={cn("w-full table-fixed border-collapse text-left text-[15px] leading-6", wide && "min-w-[560px]")}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {head.map((h) => (
              <th
                key={h}
                scope="col"
                className={cn(
                  "border-b py-2.5 px-4 text-left text-[13px] font-medium text-muted-foreground",
                  wide && head.indexOf(h) === 0 && "w-[26%]",
                  wide && head.indexOf(h) === head.length - 1 && "w-[32%]"
                )}
              >
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
                    "py-3 px-4 align-top",
                    // Code breaks at spaces, never in the middle of a name; only the file paths in the first column may break.
                    j === 0
                      ? "font-medium text-foreground [&_code]:[overflow-wrap:anywhere]"
                      : "text-reading [&_code]:[overflow-wrap:normal]",
                    j === 0 && !wide && "sm:w-[34%]",
                    j === 0 && wide && "sm:w-[26%]",
                    // The last column (the default, or the start command) gets room of its own, so it never narrows to a sliver.
                    wide && j === r.length - 1 && j !== 0 && "sm:w-[32%]"
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

/** A source note such as "server/projects.ts and server/deploy/layout.ts" as one entry each. */
function sourceLines(source: string): string[] {
  return source
    .split(/\s+and\s+|,\s*/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * The limits of a feature as a table: a header row, then one row per limit with
 * the name, the value and what happens at it, each in its own column. Under what
 * happens sits one muted line of source per file in the code that holds the
 * number, each on its own line and never broken inside a path. The frame scrolls
 * sideways before the columns get cramped.
 * - `rows`: `name`, `value`, `atLimit`, and an optional `source` (files, separated by "and" or a comma).
 * - `caption`: the accessible name of the scrollable region.
 */
export function LimitsTable({
  rows,
  caption,
}: {
  rows: { name: ReactNode; value: ReactNode; atLimit: ReactNode; source?: string }[];
  caption: string;
}) {
  // Header: a quiet small-caps label row with one rule under it, as in the Vercel docs.
  const th =
    "border-b py-3 px-4 text-left text-[13px] leading-4 font-medium tracking-[0.04em] text-muted-foreground uppercase";
  return (
    <div
      role="region"
      aria-label={caption}
      tabIndex={0}
      style={SCROLL_SHADOW}
      className="relative mt-8 overflow-x-auto border-y bg-background"
    >
      {/* 680px is the article column, so the table only scrolls where the screen is narrower. */}
      <table className="w-full min-w-[680px] table-fixed border-collapse text-left text-[15px] leading-6">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className={cn(th, "w-[23%]")}>
              Limit
            </th>
            <th scope="col" className={cn(th, "w-[33%]")}>
              Value
            </th>
            <th scope="col" className={cn(th, "px-4")}>
              What happens at it
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r, i) => (
            <tr key={i}>
              <th scope="row" className="py-4 px-4 text-left align-top leading-6 font-medium text-foreground">
                {r.name}
              </th>
              <td className="py-4 px-4 align-top leading-6 break-words text-foreground [&_code]:[overflow-wrap:normal]">
                {r.value}
              </td>
              <td className="py-4 px-4 align-top leading-6 break-words text-reading [&_code]:[overflow-wrap:normal]">
                {r.atLimit}
                {r.source ? (
                  <ul className="mt-2 space-y-0.5">
                    {sourceLines(r.source).map((path, j) => (
                      <li
                        key={path}
                        className="font-mono text-[13px] leading-5 whitespace-nowrap text-muted-foreground"
                      >
                        {j === 0 ? <span className="sr-only">In the code: </span> : null}
                        {path}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </td>
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

const ruleClass = {
  note: "border-l-[var(--tone-note-icon)]",
  success: "border-l-[var(--tone-success-icon)]",
  warning: "border-l-[var(--tone-warning-icon)]",
} as const;

/**
 * A short aside that sits in the text, set off by a thin rule in its tone.
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
    <div role="note" aria-label={label} className={cn("mt-8 flex gap-3 border-l-2 py-1 pl-4 text-left", ruleClass[token])}>
      <Icon aria-hidden="true" weight="regular" className={cn("mt-[3px] size-4 shrink-0", iconClass[token])} />
      <div className="min-w-0">
        <p className="text-[15px] leading-6 font-semibold text-foreground">{title}</p>
        <div className="mt-0.5 text-docs-small text-foreground/85">{children}</div>
      </div>
    </div>
  );
}

/**
 * The reading column. There is no card: the text sits directly on the app
 * background, like the page list beside it. The text keeps its 72 character
 * measure; code, tables, steps and callouts use the column's width (680px at
 * most), and they keep their own surfaces because they need a frame. The column
 * starts at the left, next to the page list, and the page header is the only
 * thing with a rule under it.
 */
export const ARTICLE = "min-w-0 max-w-[680px] min-[1536px]:max-w-[780px] pb-16";
