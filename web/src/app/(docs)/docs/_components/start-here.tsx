import Link from "next/link";
import { ArrowRightIcon, BookOpenTextIcon, ListChecksIcon, RocketIcon } from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { docsHref, sectionTitle } from "../_data/nav";
import { H2_CLASS } from "./prose";

/** One short line per card. The full summary stays on each page. */
const START: { id: string; icon: Icon; line: string }[] = [
  { id: "overview", icon: BookOpenTextIcon, line: "What Egg does and what happens on each push." },
  { id: "getting-started", icon: RocketIcon, line: "Connect a server, import a repo, deploy it." },
  { id: "quickstart", icon: ListChecksIcon, line: "A new account to a live app in four steps." },
];

/**
 * Where to begin: three cards in a row, each with an icon tile, a title and a
 * one-line summary. The whole card is the link target.
 */
export function StartHere() {
  return (
    <section aria-labelledby="docs-start-here" className="mt-10">
      <h2 id="docs-start-here" className={H2_CLASS}>
        Start here
      </h2>
      <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {START.map(({ id, icon: Icon, line }) => (
          <li key={id} className="group relative flex flex-col gap-3 rounded-lg bg-card p-5 shadow-border-small transition-shadow duration-(--dur-fast) ease-snappy hover:shadow-border-base focus-within:shadow-border-base">
            <span aria-hidden="true" className="grid size-9 place-items-center rounded-md bg-muted text-foreground">
              <Icon className="size-5" weight="regular" />
            </span>
            <div className="flex items-center justify-between gap-3">
              <Link
                href={docsHref(id)}
                className="text-[17px] leading-6 font-semibold text-foreground after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
              >
                {sectionTitle(id)}
              </Link>
              <ArrowRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-colors duration-(--dur-fast) ease-snappy group-hover:text-foreground" />
            </div>
            <p className="text-[14px] leading-6 text-muted-foreground">{line}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
