import Link from "next/link";
import { BookOpenTextIcon, CodeIcon, GaugeIcon, RocketIcon, ShieldCheckIcon, TerminalWindowIcon } from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { DOCS_NAV, docsHref } from "../_data/nav";
import { H2_CLASS } from "./prose";

/** Card title, icon and one-line note for each sidebar group, in the order the sidebar uses. */
const GROUP_CARD: Record<string, { title: string; icon: Icon; note: string }> = {
  Start: { title: "Start", icon: BookOpenTextIcon, note: "What Egg is, and your first deploy." },
  "Use it": { title: "Apps", icon: RocketIcon, note: "Deploy, configure and watch your apps." },
  Bots: { title: "Bots", icon: TerminalWindowIcon, note: "Run a chat bot or background worker." },
  Automate: { title: "Agents and API", icon: CodeIcon, note: "Let agents and scripts call Egg." },
  Watch: { title: "Monitoring", icon: GaugeIcon, note: "Know that apps are up, and what changed." },
  Reference: { title: "Reference", icon: ShieldCheckIcon, note: "Security, limits and fixes." },
};


/** How many section links each card shows before "and N more". */
const SHOWN = 5;

/**
 * One card per sidebar group: the group's icon, its name, a one-line note and the
 * first few pages in it. Built from `DOCS_NAV`, so it cannot drift from the sidebar.
 */
export function DocsBrowse() {
  return (
    <section aria-labelledby="docs-browse" className="mt-12">
      <h2 id="docs-browse" className={H2_CLASS}>
        Browse the docs
      </h2>
      <ul className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {DOCS_NAV.map(({ group, sections }) => {
          const card = GROUP_CARD[group] ?? { title: group, icon: BookOpenTextIcon, note: "" };
          const Icon = card.icon;
          const shown = sections.slice(0, SHOWN);
          const more = sections.length - shown.length;
          return (
            <li key={group} className="flex flex-col gap-3 rounded-lg bg-card p-5 shadow-border-small">
              <div className="flex items-center gap-3">
                <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-foreground">
                  <Icon className="size-5" weight="regular" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-[17px] leading-6 font-semibold text-foreground">{card.title}</h3>
                  <p className="text-[13px] leading-5 text-muted-foreground">{card.note}</p>
                </div>
              </div>
              <ul className="flex flex-col gap-1.5 text-[14px] leading-6">
                {shown.map((s) => (
                  <li key={s.id}>
                    <Link href={docsHref(s.id)} className="text-muted-foreground transition-colors duration-(--dur-fast) hover:text-foreground">
                      {s.title}
                    </Link>
                  </li>
                ))}
                {more > 0 ? <li className="text-[13px] text-subtle-foreground">and {more} more</li> : null}
              </ul>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
