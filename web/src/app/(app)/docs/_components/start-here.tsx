import Link from "next/link";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr";
import { docsHref, sectionTitle } from "../_data/nav";
import { SUMMARIES } from "../_data/summaries";
import { H2_CLASS } from "./prose";

const START = ["overview", "quickstart"];

/**
 * Where to begin: the two pages to read first, side by side (stacked on a
 * phone). The whole card is the link target.
 */
export function StartHere() {
  return (
    <section aria-labelledby="docs-start-here" className="mt-[60px]">
      <h2 id="docs-start-here" className={H2_CLASS}>
        Start here
      </h2>
      <ul className="mt-[30px] grid gap-[15px] sm:grid-cols-2">
        {START.map((id) => (
          <li key={id} className="group relative rounded-md border bg-background-subtle p-4 transition-colors duration-(--dur-fast) hover:bg-[var(--ds-gray-alpha-100)] max-sm:p-3">
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
            <p className="mt-1 text-[15px] leading-6 text-muted-foreground">{SUMMARIES[id]}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
