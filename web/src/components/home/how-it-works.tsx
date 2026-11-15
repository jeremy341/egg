import { HOME_FACTS, numberWord } from "@/components/marketing/home-facts";
import { Cell } from "@/components/marketing/readout";
import { ReleasePicker } from "./release-picker";
import { BODY, FRAME, H2, H3, SECTION, SMALL } from "./shared";

const { buildMemoryGb, defaultPort, healthWaitSeconds, releasesKept } = HOME_FACTS;

/** Each stop is stated in the code: build.ts (shallow clone, memory limit), the SSH upload, pipeline.ts (health wait). */
const STOPS: { name: string; detail: React.ReactNode }[] = [
  { name: "Clone", detail: "Your branch only, without its history." },
  { name: "Build", detail: `In a sandbox with ${buildMemoryGb} GB of memory.` },
  { name: "Upload", detail: "To your container, over SSH." },
  {
    name: "Switch",
    detail: (
      <>
        <code className="font-mono text-[0.9em] text-foreground">current</code> points at the new release.
      </>
    ),
  },
  { name: "Check", detail: `Egg waits up to ${healthWaitSeconds} seconds for your app to answer.` },
];

/** Wording from remote.ts (healthCheck) and pipeline.ts (the revert). */
const FAILED_LOG = [
  { text: `No healthy response on port ${defaultPort} after ${healthWaitSeconds}s`, failed: true },
  { text: "Reverting to the previous release" },
  { text: "The previous release is serving traffic again." },
];

/**
 * How a push goes live: five stops on one rail, then the fork at the end of
 * it. Left, the app answered and is live, with the releases kept for a
 * rollback. Right, it did not, and the old release came back.
 */
export function HowItWorks() {
  return (
    <section id="product" aria-labelledby="product-title" className={SECTION}>
      <h2 id="product-title" className={H2}>
        What happens when you push
      </h2>
      <p className={`${BODY} mt-5 max-w-[56ch]`}>
        Egg builds your app, puts it on your container and waits for it to answer. A release that never answers is
        taken back out, so a bad push does not take your app down.
      </p>

      <ol className="m-0 mt-[60px] grid list-none grid-cols-1 p-0 lg:grid-cols-5">
        {STOPS.map((stop) => (
          <li
            key={stop.name}
            className="relative border-l border-foreground/25 pb-[30px] pl-6 last:pb-0 lg:border-t lg:border-l-0 lg:pt-6 lg:pr-6 lg:pb-0 lg:pl-0"
          >
            <span aria-hidden="true" className="absolute top-2 -left-[5px] size-[9px] bg-foreground lg:-top-[5px] lg:left-0" />
            <h3 className={H3}>{stop.name}</h3>
            <p className="m-0 mt-1 text-[0.9375rem] leading-6 text-muted-foreground">{stop.detail}</p>
          </li>
        ))}
      </ol>

      <div className="mt-[60px] grid grid-cols-1 gap-x-6 gap-y-[60px] lg:mt-[90px] lg:grid-cols-2">
        <div className="min-w-0 border-t-2 border-foreground pt-6">
          <h3 className={H3}>If it answers</h3>
          <p className={`${BODY} mt-2 max-w-[48ch]`}>
            The new release is live. The last {numberWord(releasesKept)} stay on your container, so you can roll back
            to any of them.
          </p>
          <div className={`${FRAME} mt-[30px] p-4 sm:p-5`}>
            <ReleasePicker />
          </div>
        </div>

        <div className="min-w-0 border-t-2 border-foreground pt-6">
          <h3 className={H3}>If it does not</h3>
          <p className={`${BODY} mt-2 max-w-[48ch]`}>
            Egg puts the previous release back and the log tells you why. Database changes are not reversed.
          </p>
          <figure className={`${FRAME} m-0 mt-[30px]`}>
            <figcaption className={`${SMALL} flex items-center justify-between border-b border-border px-4 py-2`}>
              <span>Deploy log</span>
              <span>Sample</span>
            </figcaption>
            <ol className="m-0 list-none py-3 pr-4 pl-1 font-mono text-[0.8125rem] leading-[30px]">
              {FAILED_LOG.map((l) => (
                <li
                  key={l.text}
                  className={`grid grid-cols-[30px_minmax(0,1fr)] items-start [overflow-wrap:anywhere] ${l.failed ? "text-foreground" : "text-muted-foreground"}`}
                >
                  {l.failed ? <Cell state="fail" className="-mt-px" /> : <span aria-hidden="true" />}
                  <span>
                    {l.failed ? <span className="sr-only">Failed: </span> : null}
                    {l.text}
                  </span>
                </li>
              ))}
            </ol>
          </figure>
        </div>
      </div>
    </section>
  );
}
