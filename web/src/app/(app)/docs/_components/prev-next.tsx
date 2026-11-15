import Link from "next/link";
import { ArrowLeftIcon, ArrowRightIcon } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { docsHref, groupOf, neighbors } from "../_data/nav";

const card =
  "group flex min-h-[90px] min-w-0 flex-1 flex-col justify-center gap-1 bg-card px-5 py-3 transition-colors duration-(--dur-fast) hover:bg-[var(--ds-gray-100)] active:translate-y-px max-sm:min-h-[75px] -outline-offset-2";

/**
 * The page before and after this one, in reading order, so the docs can be
 * read straight through. Crossing into another group names the group.
 */
export function PrevNext({ sectionId }: { sectionId: string }) {
  const { prev, next } = neighbors(sectionId);
  if (!prev && !next) return null;
  const here = groupOf(sectionId);

  return (
    <nav aria-label="Previous and next page" className="mt-[90px] flex flex-col gap-px overflow-hidden rounded-md border bg-border sm:flex-row">
      {prev ? (
        <Link href={docsHref(prev.id)} rel="prev" className={card}>
          <span className="flex items-center gap-1.5 text-[13px] leading-5 text-muted-foreground">
            <ArrowLeftIcon
              aria-hidden="true"
              className="size-3.5 transition-transform duration-(--dur-fast) ease-snappy group-hover:-translate-x-0.5"
            />
            Previous
          </span>
          <span className="text-[16px] leading-6 font-semibold text-foreground">{prev.title}</span>
          {groupOf(prev.id) !== here ? (
            <span className="text-[13px] leading-5 text-muted-foreground">{groupOf(prev.id)}</span>
          ) : null}
        </Link>
      ) : (
        <span className="hidden flex-1 bg-card sm:block" aria-hidden="true" />
      )}
      {next ? (
        <Link href={docsHref(next.id)} rel="next" className={cn(card, "sm:items-end sm:text-right")}>
          <span className="flex items-center gap-1.5 text-[13px] leading-5 text-muted-foreground">
            Next
            <ArrowRightIcon
              aria-hidden="true"
              className="size-3.5 transition-transform duration-(--dur-fast) ease-snappy group-hover:translate-x-0.5"
            />
          </span>
          <span className="text-[16px] leading-6 font-semibold text-foreground">{next.title}</span>
          {groupOf(next.id) !== here ? (
            <span className="text-[13px] leading-5 text-muted-foreground">{groupOf(next.id)}</span>
          ) : null}
        </Link>
      ) : (
        <span className="hidden flex-1 bg-card sm:block" aria-hidden="true" />
      )}
    </nav>
  );
}
