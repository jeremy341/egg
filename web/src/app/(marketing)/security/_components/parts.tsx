import type { ReactNode } from "react";
import { ArrowRightIcon, WarningIcon } from "@phosphor-icons/react/dist/ssr";

/*
 * The pieces the Security and Privacy pages are made of. Both pages are
 * documents, so these stay plain: one sheet on the page grid, a section with
 * its heading beside its text, paragraphs, lists, a term-and-description list
 * and a small table. The type follows the public site: Pixelify on every
 * heading, 17px body on a 30px line, at most 68 characters wide.
 */

/** The page column with the list of sections beside the sheet. Below 1024px the list sits above it, closed. */
export const DOCUMENT_LAYOUT =
  "board-col mt-10 grid items-start gap-6 pb-[90px] lg:mt-[60px] lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-[30px] lg:pb-[150px]";

/** The one surface the text sits on. Sections inside it are divided by a single hairline. */
export const SHEET = "divide-y border bg-background";

/** Padding of a block on the sheet: one 30px cell from 640px, two thirds of it on phones. */
const BLOCK = "px-5 py-10 sm:px-[30px] sm:py-[45px]";

/** The page title, on the grid above the sheet. */
export function PageTitle({ children }: { children: ReactNode }) {
  return (
    <h1 className="max-w-[18ch] font-pixel text-[clamp(2.25rem,5vw,4rem)] leading-[1.05] font-medium text-balance text-foreground">
      {children}
    </h1>
  );
}

/** The paragraph under the page title. */
export function Lead({ children }: { children: ReactNode }) {
  return <p className="mt-5 max-w-[68ch] text-[1.0625rem] leading-[1.875rem] text-reading">{children}</p>;
}

/**
 * The caution every reader should see before the detail: a framed note with an
 * icon and a bold opening sentence. `title` is that sentence.
 */
export function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <aside className="mt-8 flex max-w-[76ch] gap-4 border bg-background p-5 text-[0.9375rem] leading-[1.625rem] text-reading">
      <WarningIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-foreground" />
      <p className="m-0">
        <strong className="font-semibold text-foreground">{title}</strong> {children}
      </p>
    </aside>
  );
}

/**
 * One section of the page. From 1280px the heading sits in its own column
 * beside the text, so the headings can be scanned down the left edge of the
 * sheet; below that it sits above the text.
 */
export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={`scroll-mt-20 ${BLOCK} xl:grid xl:grid-cols-[13rem_minmax(0,1fr)] xl:gap-x-[30px]`}
    >
      <h2
        id={`${id}-title`}
        className="font-pixel text-[1.625rem] leading-8 font-medium text-balance text-foreground sm:text-docs-h2 xl:text-[1.5rem] xl:leading-[1.875rem]"
      >
        {title}
      </h2>
      <div className="mt-5 flex max-w-[68ch] flex-col gap-4 text-[1.0625rem] leading-[1.875rem] text-reading xl:mt-0">
        {children}
      </div>
    </section>
  );
}

/** A smaller heading inside a section. */
export function Sub({ children }: { children: ReactNode }) {
  return <h3 className="mt-4 font-pixel text-[1.25rem] leading-[1.875rem] font-medium text-foreground">{children}</h3>;
}

/** Inline code: a file name, a path, a service name. It may break anywhere so it never pushes the page wide. */
export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-[3px] bg-background-subtle px-1 py-0.5 font-mono text-[0.875em] leading-none [overflow-wrap:anywhere] text-foreground">
      {children}
    </code>
  );
}

/** A plain bulleted list. */
export function Points({ children }: { children: ReactNode }) {
  return <ul className="m-0 flex list-[square] flex-col gap-2.5 pl-5 marker:text-subtle-foreground">{children}</ul>;
}

/** A numbered list, for steps that happen in order. */
export function Steps({ children }: { children: ReactNode }) {
  return <ol className="m-0 flex list-decimal flex-col gap-2.5 pl-5 marker:font-medium marker:text-foreground">{children}</ol>;
}

/** A list of named things, set apart from the paragraphs around it by one rule above and one below. */
export function Terms({ children }: { children: ReactNode }) {
  return <dl className="m-0 flex flex-col gap-5 border-y py-5">{children}</dl>;
}

/** One named thing: the name on its own line, what it is underneath. */
export function Term({ name, children }: { name: ReactNode; children: ReactNode }) {
  return (
    <div>
      <dt className="font-semibold text-foreground">{name}</dt>
      <dd className="m-0 mt-1">{children}</dd>
    </div>
  );
}

const linkClass =
  "text-foreground underline decoration-border decoration-1 underline-offset-4 outline-offset-2 transition-[text-decoration-color] duration-(--dur-fast) hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-[var(--ds-focus-color)]";

/** A link in running text. External links open in a new tab and say so to screen readers. */
export function TextLink({ href, external, children }: { href: string; external?: boolean; children: ReactNode }) {
  return (
    <a href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})} className={linkClass}>
      {children}
      {external ? <span className="sr-only"> (opens in a new tab)</span> : null}
    </a>
  );
}

/** A link that jumps to a section of the same page, with an arrow so it reads as a way onward and not as a term. */
export function JumpLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className={`touch-target inline-flex items-center gap-1.5 text-[0.9375rem] leading-6 font-medium max-sm:min-h-10 ${linkClass}`}
    >
      {children}
      <ArrowRightIcon aria-hidden="true" className="size-4 shrink-0" />
    </a>
  );
}

export type Brief = { text: ReactNode; href: string; section: string };

/**
 * The page in a few sentences, as the first block of the sheet. Each sentence
 * repeats one stated further down, in the same words, and links to the section
 * that explains it. It is a plain list: no frames and no icons.
 */
export function InShort({ id, title, items }: { id: string; title: string; items: readonly Brief[] }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={`scroll-mt-20 ${BLOCK}`}>
      <h2 id={`${id}-title`} className="font-pixel text-[1.625rem] leading-8 font-medium text-foreground sm:text-docs-h2">
        {title}
      </h2>
      <ul className="m-0 mt-6 grid list-none gap-x-[60px] gap-y-6 p-0 md:grid-cols-2">
        {items.map((item) => (
          <li key={item.href + item.section} className="flex max-w-[52ch] flex-col items-start gap-1">
            <p className="m-0 text-[1.0625rem] leading-[1.875rem] text-foreground">{item.text}</p>
            <JumpLink href={item.href}>{item.section}</JumpLink>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A small two-column table: what is limited, and the limit. Scrolls sideways inside its frame, never the page. */
export function LimitTable({ caption, head, rows }: { caption: string; head: [string, string]; rows: [ReactNode, ReactNode][] }) {
  return (
    <div className="overflow-x-auto border">
      <table className="w-full border-collapse text-left text-[0.9375rem] leading-6">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b bg-background-subtle">
            <th scope="col" className="px-4 py-2.5 font-medium text-foreground">
              {head[0]}
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium text-foreground">
              {head[1]}
            </th>
          </tr>
        </thead>
        <tbody className="tabular">
          {rows.map(([what, limit], i) => (
            <tr key={i} className="align-top">
              <th scope="row" className="px-4 py-2 font-normal text-reading">
                {what}
              </th>
              <td className="px-4 py-2 font-medium whitespace-nowrap text-foreground max-sm:whitespace-normal">{limit}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
