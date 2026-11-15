import Link from "next/link";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr";
import { docsHref, sectionTitle } from "../_data/nav";
import { SUMMARIES } from "../_data/summaries";

const START = ["overview", "quickstart"];

/**
 * Where to begin: the two pages to read first, side by side (stacked on a
 * phone). Each is a heavy ink rule, a title and its summary; the whole block
 * is the link target. There is no frame, so the page grid shows through.
 */
export function StartHere() {
  return (
    <section aria-labelledby="docs-start-here" className="mt-[60px]">
      <h2 id="docs-start-here" className="text-foreground text-[22px] leading-[30px] font-semibold tracking-[-0.02em] max-sm:text-[20px]">
        Start here
      </h2>
      <ul className="mt-[30px] grid gap-x-[30px] gap-y-[30px] sm:grid-cols-2">
        {START.map((id) => (
          <li key={id} className="group relative border-t-2 border-t-foreground pt-[13px] pb-[2px]">
            <Link
              href={docsHref(id)}
              className="flex items-center justify-between gap-4 text-[19px] leading-[30px] font-semibold text-foreground after:absolute after:inset-0 after:content-[''] focus-visible:outline-offset-4"
            >
              {sectionTitle(id)}
              <ArrowRightIcon
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground transition-transform duration-(--dur-fast) ease-snappy group-hover:translate-x-1 group-hover:text-foreground"
              />
            </Link>
            <p className="max-w-[48ch] text-[16px] leading-6 text-muted-foreground">{SUMMARIES[id]}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
