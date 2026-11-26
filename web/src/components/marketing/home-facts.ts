/**
 * The numbers and names the homepage states as fact. Each one is checked
 * against the code that enforces it in home-facts.test.ts, so the page cannot
 * drift from the product without a failing test.
 */
export const HOME_FACTS = {
  /** Production releases kept on the container (KEEP_RELEASES). */
  releasesKept: 5,
  /** First port a preview gets (PREVIEW_PORT_MIN). */
  previewPortMin: 20000,
  /** How recent a Hack Club sign-in must be to switch the terminal or file changes on. */
  reauthMinutes: 5,
  /** An open terminal ends after this long without input. */
  terminalIdleMinutes: 10,
  /** An open terminal never lives longer than this. */
  terminalMaxMinutes: 60,
  /** Page view numbers are kept for one of these many days, as the owner chooses for each project (featuresPatch.retentionDays). */
  pageviewDayChoices: [30, 60, 90],
  /** A project keeps page view numbers this long until its owner chooses (NO_FEATURES.retentionDays, PAGEVIEW_KEEP_MS). */
  pageviewDays: 90,
  /** The status page looks back this far. */
  statusWindowDays: 30,
  /** Uptime checks run this often unless MONITOR_INTERVAL_MS says otherwise. */
  checkIntervalMinutes: 5,
  /** Failed checks in a row before an alert goes out (FAILURES_BEFORE_DOWN). */
  failedChecksBeforeAlert: 2,
  /** A deploy waits this long for the app to answer before it reverts. */
  healthWaitSeconds: 45,
  /** A build on the container is capped at this much memory (MB) until the owner changes it (DEFAULT_CONTAINER_BUILD_MEMORY_MB). */
  buildMemoryMb: 512,
  /** A project with a build step gets at least this much while it builds, if the container has room (BUILD_STEP_FLOOR_MB). */
  buildStepFloorMb: 1024,
  /** A token with the terminal or file scope expires within this many days. */
  shortLivedDays: 7,
  /** The port the new project form fills in, used in the sample logs. */
  defaultPort: 3000,
} as const;

/** Every permission a token can hold, in the order the Developer page lists them. */
export const TOKEN_SCOPES = [
  "projects:read",
  "projects:write",
  "deployments:read",
  "deployments:write",
  "jobs:read",
  "jobs:write",
  "logs:read",
  "env:read",
  "env:write",
  "domains:read",
  "domains:write",
  "notifications:read",
  "alerts:read",
  "analytics:read",
  "activity:read",
  "resources:read",
  "container:read",
  "files:read",
  "files:write",
  "terminal:use",
  "webhooks:read",
  "webhooks:write",
] as const;

/** The example token on the homepage: what a deploy script needs, and nothing more. */
export const DEPLOY_BOT_SCOPES: readonly string[] = [
  "projects:read",
  "deployments:read",
  "deployments:write",
  "logs:read",
];

/** MCP tools named on the homepage. Each is a real tool on /api/mcp. */
export const MCP_TOOLS_SHOWN = ["list_projects", "deploy_branch", "get_logs", "get_server_usage"] as const;

/** The page view script tag, as the Analytics settings give it, for a placeholder origin and key. */
export function analyticsSnippet(origin: string, key: string): string {
  return `<script defer data-key="${key}" src="${origin}/api/analytics/script?key=${key}"></script>`;
}

/** A small count as a word, for running text ("the last five releases"). */
export function numberWord(n: number): string {
  return ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][n] ?? String(n);
}
