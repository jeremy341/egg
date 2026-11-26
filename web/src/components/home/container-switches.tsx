import type { ReactNode } from "react";
import { HOME_FACTS, numberWord } from "@/components/marketing/home-facts";
import { Cell } from "@/components/marketing/readout";
import { BODY, FRAME, H2, SECTION, SMALL } from "./shared";

const { reauthMinutes, terminalIdleMinutes, terminalMaxMinutes } = HOME_FACTS;

/** The three container permissions, as the server settings page lists them. All are off for a new container. */
const SWITCHES: { name: string; text: ReactNode }[] = [
  {
    name: "Terminal",
    text: `A root shell on your container, in the browser. It closes after ${terminalIdleMinutes} minutes without input, or ${terminalMaxMinutes} minutes in all.`,
  },
  {
    name: "File changes",
    text: (
      <>
        Edit and upload files in <code className="font-mono text-[0.9em] text-foreground">shared/</code> only. The live
        release stays read only.
      </>
    ),
  },
  {
    name: "Removing leftovers",
    text: "Deletes only what Egg created and marked. Each removal asks first.",
  },
];

/**
 * Trust: what Egg can do on a container, and what waits until you say so. The
 * statement first, then the three switches in one strip, each drawn off, the
 * way the server settings page shows them.
 */
export function ContainerSwitches() {
  return (
    <section id="security" aria-labelledby="security-title" className={SECTION}>
      <h2 id="security-title" className={`${H2} max-w-[20ch]`}>
        The risky parts start switched off
      </h2>
      <p className={`${BODY} mt-5 max-w-[60ch]`}>
        Egg reaches your container with an SSH key you add in the Nest dashboard and can delete at any time. Turning
        on the terminal or file changes needs a Hack Club sign-in from the last {numberWord(reauthMinutes)} minutes.
      </p>

      <ul
        aria-label="Switches on a new container"
        className={`${FRAME} m-0 mt-10 grid list-none grid-cols-1 p-0 lg:mt-[60px] lg:grid-cols-3`}
      >
        {SWITCHES.map((s) => (
          <li
            key={s.name}
            className="border-t border-border p-5 first:border-t-0 sm:p-6 lg:border-t-0 lg:border-l lg:first:border-l-0"
          >
            <div className="flex items-center justify-between gap-4">
              <p className="m-0 text-[1.0625rem] leading-7 font-semibold text-foreground">{s.name}</p>
              <p className={`${SMALL} m-0 flex items-center font-medium text-foreground`}>
                <Cell state="ghost" />
                Off
              </p>
            </div>
            <p className="m-0 mt-2 text-[0.9375rem] leading-6 text-muted-foreground">{s.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
