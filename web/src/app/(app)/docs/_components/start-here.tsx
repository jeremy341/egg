import Link from "next/link";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr";
import { docsHref, sectionTitle } from "../_data/nav";
import { SUMMARIES } from "../_data/summaries";
import { H2_CLASS } from "./prose";

const START = ["overview", "getting-started", "quickstart"];

/**
 * Where to begin: the pages to read first, as hairline rows like the page
 * list below them. The whole row is the link target.
 */
export function StartHere() {
  return (
    <section aria-labelledby="docs-start-here" className="mt-10">
      <h2 id="docs-start-here" className={H2_CLASS}>
        Start here
      </h2>
      <ul className="mt-4 divide-y border-y">
        {START.map((id) => (
          <li key={id} className="group relative py-4">
            <Link
              href={docsHref(id)}
              className="flex items-center justify-between gap-4 text-[17px] leading-6 font-semibold text-foreground after:absolute after:inset-0 after:content-[''] focus-visible:outline-offset-4"
            >
              {sectionTitle(id)}
              <ArrowRightIcon
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground transition-colors duration-(--dur-fast) ease-snappy group-hover:text-foreground"
              />
            </Link>
            <p className="mt-1 text-[14px] leading-6 text-muted-foreground">{SUMMARIES[id]}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
