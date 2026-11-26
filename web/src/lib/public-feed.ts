import { timeAgo } from "@/lib/status";
import type { DeploymentView } from "@/server/queries";
import type { FeedRow } from "@/server/public-feed";

/** The live list needs at least this many rows. With fewer it would look empty, so the sample list is shown. */
export const MIN_LIVE_ROWS = 3;

/** What the caption under the homepage list says, matched to what is shown. */
export const LIVE_CAPTION = "Live: recent deployments from public projects that chose to show them";
export const SAMPLE_CAPTION = "Sample data";

/** Whether the homepage shows the live feed or the sample list. */
export function homepageListMode(rows: readonly unknown[] | null | undefined): "live" | "sample" {
  return rows && rows.length >= MIN_LIVE_ROWS ? "live" : "sample";
}

/**
 * Feed rows as the list component wants them. Only public fields are copied; every other field of
 * the view is a fixed placeholder, so nothing about the real project (its id, port, author or error)
 * is sent to the browser with the homepage.
 */
export function feedRowsToViews(rows: readonly FeedRow[], now = Date.now()): DeploymentView[] {
  return rows.map((r, i) => ({
    id: `live-${i}`,
    projectId: "live",
    projectSlug: "live",
    projectName: r.repo,
    repo: r.repo,
    env: r.env,
    state: r.state,
    rawState: r.state,
    source: "webhook",
    branch: r.branch,
    sha: r.sha,
    commit: r.message,
    pr: null,
    author: r.by,
    age: timeAgo(r.at, now),
    duration: "",
    durationMs: null,
    port: 0,
    isCurrent: false,
    cleanedUp: false,
    error: null,
    createdAt: r.at,
  }));
}
