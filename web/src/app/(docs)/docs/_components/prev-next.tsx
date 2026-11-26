import Link from "next/link";
import { ArrowLeftIcon, ArrowRightIcon } from "@phosphor-icons/react/dist/ssr";
import { docsHref, groupOf, neighbors } from "../_data/nav";

const card =
  "group flex min-h-20 min-w-0 flex-col justify-center gap-1 rounded-lg border px-4 py-3 text-left transition-colors duration-(--dur-fast) hover:border-[var(--ds-gray-alpha-300)] hover:bg-[var(--ds-gray-alpha-100)] active:translate-y-px -outline-offset-2";

/**
 * The page before and after this one, in reading order, so the docs can be
 * read straight through. Crossing into another group names the group. Two
 * plain links with a thin outline each, side by side (stacked on a phone), after
 * a gap that ends the article.
 */
export function PrevNext({ sectionId }: { sectionId: string }) {
  const { prev, next } = neighbors(sectionId);
  if (!prev && !next) return null;
  const here = groupOf(sectionId);

  return (
    <nav aria-label="Previous and next page" className="mt-16">
      <div className="grid gap-3 sm:grid-cols-2">
        {prev ? (
          <Link href={docsHref(prev.id)} rel="prev" className={card}>
            <span className="flex items-center gap-1.5 text-[13px] leading-5 text-muted-foreground">
              <ArrowLeftIcon
                aria-hidden="true"
                className="size-3.5"
              />
              Previous
            </span>
            <span className="text-[15px] leading-6 font-semibold text-foreground">{prev.title}</span>
            {groupOf(prev.id) !== here ? (
              <span className="text-[13px] leading-5 text-muted-foreground">{groupOf(prev.id)}</span>
            ) : null}
          </Link>
        ) : (
          <span className="hidden sm:block" aria-hidden="true" />
        )}
        {next ? (
          <Link href={docsHref(next.id)} rel="next" className={card}>
            <span className="flex items-center gap-1.5 text-[13px] leading-5 text-muted-foreground">
              Next
              <ArrowRightIcon
                aria-hidden="true"
                className="size-3.5"
              />
            </span>
            <span className="text-[15px] leading-6 font-semibold text-foreground">{next.title}</span>
            {groupOf(next.id) !== here ? (
              <span className="text-[13px] leading-5 text-muted-foreground">{groupOf(next.id)}</span>
            ) : null}
          </Link>
        ) : (
          <span className="hidden sm:block" aria-hidden="true" />
        )}
      </div>
    </nav>
  );
}
