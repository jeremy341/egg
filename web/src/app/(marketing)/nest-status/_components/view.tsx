import Link from "next/link";
import { cn } from "@/lib/utils";
import type { NestStatus, OverallState, TargetState, TargetStatus } from "@/server/nest-status";
import { OFFICIAL_NOTE, OFFICIAL_UNAVAILABLE, SCOPE_NOTE } from "../copy";
import { PAD, SURFACE } from "../../stats/_components/layout";
import { DayStrip } from "./strip";

const stamp = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

const OVERALL_MARK: Record<OverallState, string> = {
  ok: "bg-ready",
  degraded: "bg-[var(--status-building)]",
  down: "bg-[var(--status-error)]",
  unknown: "bg-[var(--ds-gray-600)]",
};

const TARGET_MARK: Record<TargetState, string> = {
  up: "bg-ready",
  slow: "bg-[var(--status-building)]",
  down: "bg-[var(--status-error)]",
  unknown: "bg-[var(--ds-gray-600)]",
};

const TARGET_WORDS: Record<TargetState, string> = {
  up: "Answering",
  slow: "Answering slowly",
  down: "Not answering",
  unknown: "No recent checks",
};

/** 312 ms, or 2.4 s from a second up. */
export function formatMs(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** What the newest check saw, in words. */
export function lastCheckText(t: TargetStatus): string {
  if (!t.checkedAt) return "No check has run yet";
  if (t.httpStatus !== null) return `HTTP ${t.httpStatus}${t.latencyMs !== null ? ` in ${formatMs(t.latencyMs)}` : ""}`;
  if (t.latencyMs !== null) return `The database answered in ${formatMs(t.latencyMs)}`;
  return t.id === "egg" ? "The database did not answer" : "No reply";
}

function When({ iso }: { iso: string }) {
  return <time dateTime={iso}>{stamp.format(new Date(iso))} UTC</time>;
}

function Target({ t, windowDays }: { t: TargetStatus; windowDays: number }) {
  const headingId = `target-${t.id}`;
  return (
    <section aria-labelledby={headingId} className={PAD}>
      <h2 id={headingId} className="text-title-3">
        {t.url ? (
          <a href={t.url} target="_blank" rel="noreferrer" className="link">
            {t.label}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : (
          t.label
        )}
      </h2>
      {t.url ? <p className="mt-1 text-caption text-muted-foreground">{t.url.replace("https://", "")}</p> : null}
      <p className="mt-3 flex items-center gap-3 text-title-2">
        <span aria-hidden="true" className={cn("size-2.5 shrink-0", TARGET_MARK[t.state])} />
        {TARGET_WORDS[t.state]}
      </p>
      <dl className="mt-4 grid gap-x-8 gap-y-3 text-label sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Last check</dt>
          <dd className="tabular mt-0.5">{lastCheckText(t)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Median, last 24 hours</dt>
          <dd className="tabular mt-0.5">{t.median24hMs !== null ? formatMs(t.median24hMs) : "No data"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Median, last {windowDays} days</dt>
          <dd className="tabular mt-0.5">{t.median30dMs !== null ? formatMs(t.median30dMs) : "No data"}</dd>
        </div>
      </dl>
      <div className="mt-5">
        <DayStrip days={t.days} name={`${t.label}, last ${windowDays} days`} />
      </div>
    </section>
  );
}

/** The whole page body. Plain data in, so it renders the same in a test as on the server. */
export function NestStatusView({ status }: { status: NestStatus }) {
  const { official } = status;
  return (
    <div className={SURFACE}>
      <section aria-labelledby="overall" className={PAD}>
        <h2 id="overall" className="sr-only">
          Overall
        </h2>
        <p className="font-pixel flex items-start gap-3 text-[28px] leading-9 font-medium">
          <span aria-hidden="true" className={cn("mt-2.5 size-3 shrink-0", OVERALL_MARK[status.overall.state])} />
          {status.overall.text}
        </p>
        <p className="mt-3 max-w-[65ch] text-body-lg text-reading">{SCOPE_NOTE}</p>
        <p className="mt-3 text-label text-muted-foreground">
          {status.lastCheckAt ? (
            <>
              Last checked <When iso={status.lastCheckAt} />, from the Egg server at {status.checkedFrom}. Checks run
              every {status.intervalSeconds} seconds.
            </>
          ) : (
            <>No check has been recorded yet. Checks run every {status.intervalSeconds} seconds from the Egg server at {status.checkedFrom}.</>
          )}
        </p>
      </section>

      <div className="divide-y">
        {status.targets.map((t) => (
          <Target key={t.id} t={t} windowDays={status.windowDays} />
        ))}
      </div>

      <section aria-labelledby="official" className={PAD}>
        <h2 id="official" className="text-title-3">
          Hack Club&rsquo;s official Nest status
        </h2>
        {official.available ? (
          <>
            <p className="mt-3 text-title-2">{official.summary}</p>
            <p className="mt-1 text-label text-muted-foreground">
              Read from{" "}
              <a href={official.url} target="_blank" rel="noreferrer" className="link">
                status.hackclub.app
                <span className="sr-only"> (opens in a new tab)</span>
              </a>{" "}
              at <When iso={official.readAt} />. It is shown as Hack Club words it and is not part of Egg&rsquo;s checks above.
            </p>
          </>
        ) : (
          <p className="mt-3 text-title-2">{OFFICIAL_UNAVAILABLE}</p>
        )}
        <p className="mt-3 max-w-[65ch] text-body-lg text-reading">{OFFICIAL_NOTE}</p>
        <p className="mt-3 text-label">
          <a href={official.url} target="_blank" rel="noreferrer" className="link">
            Open status.hackclub.app
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </p>
      </section>

      <section aria-labelledby="more" className={PAD}>
        <h2 id="more" className="text-title-3">
          More
        </h2>
        <p className="mt-3 max-w-[65ch] text-body text-muted-foreground">
          A check fails when nothing answers within 10 seconds, or the answer is a server error (5xx). Two failed checks in
          a row mark a target as down, the same rule the project alerts use. An answer slower than 2 seconds is slow.
          Days are counted in UTC. Checks are kept for 90 days. They hold no user, project or visitor data.
        </p>
        <p className="mt-3 text-label">
          The same figures as{" "}
          <Link href="/api/status/nest" prefetch={false} className="link">
            JSON
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
