import type { ReactNode } from "react";

/*
 * The small pieces the Security page is made of. The page is a document, so
 * these stay plain: a section with a heading, a few paragraphs, lists and a
 * term-and-description list. The type sizes follow the homepage (17px body on
 * 28px, a pixel heading for each section).
 */

/** One section of the page: the heading, then a column of text no wider than a comfortable line. */
export function Section({
  id,
  title,
  number,
  children,
}: {
  id: string;
  title: string;
  number: number;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-24 border-t-2 border-foreground px-5 pt-8 pb-12 sm:px-8 sm:pt-10 sm:pb-14 lg:px-10 lg:pt-12 lg:pb-16"
    >
      <div className="flex items-baseline gap-4 border-b border-border pb-5">
        <span
          aria-hidden="true"
          className="shrink-0 border border-foreground px-2 py-0.5 font-mono text-[0.8125rem] leading-5 tabular-nums text-foreground"
        >
          {String(number).padStart(2, "0")}
        </span>
        <h2
          id={`${id}-title`}
          className="font-pixel text-[clamp(1.5rem,2.4vw,2rem)] leading-[1.15] font-medium text-balance text-foreground"
        >
          {title}
        </h2>
      </div>
      <div className="mt-6 flex max-w-[65ch] flex-col gap-4 text-[1.0625rem] leading-[1.75rem] text-reading">
        {children}
      </div>
    </section>
  );
}

/** A smaller heading inside a section. */
export function Sub({ children }: { children: ReactNode }) {
  return <h3 className="mt-2 text-[1.0625rem] leading-7 font-semibold text-foreground">{children}</h3>;
}

/** Inline code: a file name, a path, a service name. It may break anywhere so it never pushes the page wide. */
export function Code({ children }: { children: ReactNode }) {
  return <code className="font-mono text-[0.9em] [overflow-wrap:anywhere] text-foreground">{children}</code>;
}

/** A plain bulleted list. */
export function Points({ children }: { children: ReactNode }) {
  return <ul className="m-0 flex list-disc flex-col gap-2 pl-5 marker:text-muted-foreground">{children}</ul>;
}

/** A list of named things: the name in bold on its own line, what it is underneath. */
export function Terms({ children }: { children: ReactNode }) {
  return <dl className="m-0 flex flex-col gap-4">{children}</dl>;
}

export function Term({ name, children }: { name: ReactNode; children: ReactNode }) {
  return (
    <div>
      <dt className="font-semibold text-foreground">{name}</dt>
      <dd className="m-0 mt-1">{children}</dd>
    </div>
  );
}

/** A link in running text. External links open in a new tab and say so to screen readers. */
export function TextLink({ href, external, children }: { href: string; external?: boolean; children: ReactNode }) {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="text-foreground underline decoration-border decoration-1 underline-offset-4 outline-offset-2 transition-[text-decoration-color] duration-(--dur-fast) hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-[var(--ds-focus-color)]"
    >
      {children}
      {external ? <span className="sr-only"> (opens in a new tab)</span> : null}
    </a>
  );
}

/** A small two-column table: what is limited, and the limit. Scrolls sideways inside its box rather than widening the page. */
export function LimitTable({ caption, head, rows }: { caption: string; head: [string, string]; rows: [ReactNode, ReactNode][] }) {
  return (
    <div className="overflow-x-auto border border-border">
      <table className="w-full border-collapse text-left text-[0.9375rem] leading-6">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border bg-background-subtle">
            <th scope="col" className="px-4 py-2.5 font-semibold text-foreground">
              {head[0]}
            </th>
            <th scope="col" className="px-4 py-2.5 font-semibold text-foreground">
              {head[1]}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([what, limit], i) => (
            <tr key={i} className="border-t border-border first:border-t-0 align-top">
              <th scope="row" className="px-4 py-2.5 font-normal text-reading">
                {what}
              </th>
              <td className="px-4 py-2.5 text-foreground">{limit}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
