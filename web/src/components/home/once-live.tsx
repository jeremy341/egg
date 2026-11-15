import { HOME_FACTS, TOKEN_SCOPES, numberWord } from "@/components/marketing/home-facts";
import { BODY, FRAME, H2, H3, SECTION, SMALL } from "./shared";

const { checkIntervalMinutes, failedChecksBeforeAlert, pageviewDays, previewPortMin, statusWindowDays } = HOME_FACTS;

/* Sample status strip: one outage, OUTAGE_AGO days before today. Index 0 is the oldest day. */
const OUTAGE_INDEX = 16;
const OUTAGE_AGO = statusWindowDays - 1 - OUTAGE_INDEX;
const STRIP_LABEL = `Sample status page strip for the last ${statusWindowDays} days: up every day except one outage ${OUTAGE_AGO} days ago.`;

/** Each item is a feature in the product today; every number is pinned in home-facts.ts. */
const ITEMS: { title: string; text: string }[] = [
  {
    title: "Previews",
    text: `Push any other branch and it runs beside production on its own port, from ${previewPortMin}.`,
  },
  {
    title: "Logs",
    text: "Build output and your app's own logs, filtered by level, ready to download.",
  },
  {
    title: "Page views",
    text: `Off until you add one script tag to your site. Counts are kept for ${pageviewDays} days.`,
  },
  {
    title: "Tokens and MCP",
    text: `Give a script a token with only the scopes it needs, out of ${TOKEN_SCOPES.length}. AI agents get the same calls over MCP.`,
  },
];

/**
 * What a project has once it is running. Left, the headline promise (it tells
 * you when your app stops answering) with the status strip it publishes.
 * Right, the rest of the project page as a short list.
 */
export function OnceLive() {
  return (
    <section id="track" aria-labelledby="track-title" className={SECTION}>
      <div className="grid grid-cols-1 gap-y-[60px] lg:grid-cols-12 lg:gap-x-6">
        <div className="min-w-0 lg:col-span-6">
          <h2 id="track-title" className={H2}>
            Know when your app stops answering
          </h2>
          <p className={`${BODY} mt-5 max-w-[46ch]`}>
            Egg checks your app every {numberWord(checkIntervalMinutes)} minutes. After{" "}
            {numberWord(failedChecksBeforeAlert)} failed checks in a row it posts to Discord or Slack. Each project can
            publish a status page with the last {statusWindowDays} days.
          </p>

          <figure className={`${FRAME} m-0 mt-10 p-4 sm:p-5`}>
            <figcaption className={`${SMALL} flex flex-col sm:flex-row sm:items-baseline sm:justify-between sm:gap-4`}>
              <span className="font-medium text-foreground">recipe-api status</span>
              <span>Sample: one outage, {OUTAGE_AGO} days ago</span>
            </figcaption>
            <div role="img" aria-label={STRIP_LABEL} className="mt-4 grid grid-cols-[repeat(30,minmax(0,1fr))] gap-[2px] sm:gap-[3px]">
              {Array.from({ length: statusWindowDays }, (_, i) => (
                <span
                  key={i}
                  aria-hidden="true"
                  className={`h-8 ${i === OUTAGE_INDEX ? "bg-destructive" : "bg-foreground/80"}`}
                />
              ))}
            </div>
            <div aria-hidden="true" className={`${SMALL} mt-2 flex justify-between`}>
              <span>{statusWindowDays} days ago</span>
              <span>Today</span>
            </div>
          </figure>
        </div>

        <dl className="m-0 grid grid-cols-1 gap-y-[30px] sm:grid-cols-2 sm:gap-x-6 lg:col-span-5 lg:col-start-8 lg:grid-cols-1 lg:pt-3">
          {ITEMS.map((item) => (
            <div key={item.title} className="border-t border-border pt-4">
              <dt className={H3}>{item.title}</dt>
              <dd className="m-0 mt-1 text-[0.9375rem] leading-6 text-muted-foreground">{item.text}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
