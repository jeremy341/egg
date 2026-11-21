/**
 * The single source of truth for the docs outline. The left nav, the mobile
 * bar, the scroll spy and every `Section` / `H3` heading read their titles
 * from here, so a title can never be typed twice or drift.
 */

export type DocsSubsection = { id: string; title: string };
export type DocsSection = { id: string; title: string; subsections: DocsSubsection[] };
export type DocsGroup = { group: string; sections: DocsSection[] };

export const DOCS_NAV: DocsGroup[] = [
  {
    group: "Start",
    sections: [
      {
        id: "overview",
        title: "How it works",
        subsections: [{ id: "overview-push", title: "What happens on a push" }],
      },
      {
        id: "getting-started",
        title: "Getting started",
        subsections: [
          { id: "getting-started-connect", title: "1. Connect your container" },
          { id: "getting-started-import", title: "2. Import a repository" },
          { id: "getting-started-deploy", title: "3. Watch the first deployment" },
          { id: "getting-started-address", title: "4. Give it an address" },
        ],
      },
      { id: "quickstart", title: "Quick start", subsections: [] },
      {
        id: "run-yourself",
        title: "Run Egg yourself",
        subsections: [
          { id: "run-yourself-modes", title: "Pick your setup" },
          { id: "run-yourself-signin", title: "Signing in without Hack Club" },
          { id: "run-yourself-target", title: "Where your apps run" },
          { id: "run-yourself-more", title: "The full guide" },
        ],
      },
      {
        id: "run-locally",
        title: "Run Egg locally",
        subsections: [
          { id: "run-locally-prereqs", title: "Prerequisites" },
          { id: "run-locally-install", title: "Install" },
          { id: "run-locally-env", title: "The env file" },
          { id: "run-locally-dev", title: "Start the dev server" },
          { id: "run-locally-devlogin", title: "Development sign-in" },
          { id: "run-locally-demo", title: "Demo data" },
          { id: "run-locally-checks", title: "Tests and lint" },
          { id: "run-locally-build", title: "The production build" },
        ],
      },
    ],
  },
  {
    group: "Use it",
    sections: [
      {
        id: "servers",
        title: "Servers",
        subsections: [
          { id: "servers-connection", title: "How the connection works" },
          { id: "servers-manage", title: "Testing, rotating and removing" },
        ],
      },
      {
        id: "projects",
        title: "Projects and runtimes",
        subsections: [
          { id: "projects-settings", title: "Settings" },
          { id: "projects-runtimes", title: "Runtimes" },
          { id: "projects-guarantees", title: "What every app can rely on" },
          { id: "projects-docker", title: "Dockerfile and Compose modes" },
        ],
      },
      {
        id: "build-github-actions",
        title: "Build with GitHub Actions",
        subsections: [
          { id: "build-actions-what", title: "What it is and why it is recommended" },
          { id: "build-actions-steps", title: "Setting it up" },
          { id: "build-actions-secrets", title: "The four secrets" },
          { id: "build-actions-pr", title: "What the pull request does" },
          { id: "build-actions-safety", title: "Forks, pull requests and production secrets" },
          { id: "build-actions-limits", title: "Limits" },
          { id: "build-actions-troubleshooting", title: "When Test connection fails" },
        ],
      },
      {
        id: "build-on-nest",
        title: "Build on Nest",
        subsections: [
          { id: "build-nest-what", title: "What it is" },
          { id: "build-nest-caps", title: "The memory and CPU cap" },
          { id: "build-nest-when", title: "When to prefer it" },
        ],
      },
      {
        id: "deployments",
        title: "Deployments",
        subsections: [
          { id: "deployments-states", title: "States" },
          { id: "deployments-actions", title: "Actions" },
          { id: "deployments-releases", title: "Releases and previews on disk" },
          { id: "deployments-previews", title: "Branch previews" },
        ],
      },
      { id: "env", title: "Environment variables", subsections: [] },
      { id: "logs", title: "Logs", subsections: [] },
      { id: "domains", title: "Domains", subsections: [] },
      {
        id: "container",
        title: "Container, terminal and files",
        subsections: [
          { id: "container-switches", title: "The three switches" },
          { id: "container-page", title: "The Container page" },
          { id: "container-leftovers", title: "Removing leftovers" },
          { id: "container-adopt", title: "Adopting an app that already runs" },
          { id: "container-terminal", title: "The terminal" },
          { id: "container-files", title: "The Files tab" },
        ],
      },
    ],
  },
  {
    group: "Bots",
    sections: [
      { id: "bots-discordjs", title: "Deploy a Discord bot (discord.js)", subsections: [] },
      { id: "bots-discordpy", title: "Deploy a Discord bot (discord.py)", subsections: [] },
      { id: "bots-slack", title: "Deploy a Slack app (Bolt)", subsections: [] },
      { id: "bots-telegram", title: "Deploy a Telegram bot", subsections: [] },
      { id: "bots-alive", title: "Keep a bot alive", subsections: [] },
    ],
  },
  {
    group: "Automate",
    sections: [
      {
        id: "github",
        title: "GitHub and previews",
        subsections: [
          { id: "github-push", title: "Deploying on push" },
          { id: "github-pr-previews", title: "Pull request previews" },
          { id: "github-actions", title: "Building on GitHub Actions" },
        ],
      },
      { id: "hooks", title: "Deploy hooks", subsections: [] },
      { id: "jobs", title: "Scheduled jobs", subsections: [] },
      { id: "notifications", title: "Notifications", subsections: [] },
      {
        id: "api",
        title: "Access tokens and the API",
        subsections: [
          { id: "api-tokens", title: "Making a token" },
          { id: "api-scopes", title: "What a token can do" },
          { id: "api-limits", title: "Terminal, files and the 7-day rule" },
          { id: "api-mcp", title: "The API and agents" },
          { id: "api-examples", title: "Examples and the TypeScript client" },
          { id: "api-addresses", title: "Addresses for tools and agents" },
        ],
      },
    ],
  },
  {
    group: "Watch",
    sections: [
      {
        id: "monitoring",
        title: "Monitoring and uptime",
        subsections: [
          { id: "monitoring-service-card", title: "The Service card" },
          { id: "monitoring-resources", title: "Resource use" },
          { id: "monitoring-uptime", title: "Uptime checks and alerts" },
        ],
      },
      { id: "status-page", title: "Status page", subsections: [] },
      {
        id: "analytics",
        title: "Analytics",
        subsections: [
          { id: "analytics-setup-steps", title: "Setting it up" },
          { id: "analytics-data", title: "What you see" },
          { id: "analytics-privacy", title: "Privacy" },
        ],
      },
      {
        id: "activity",
        title: "Activity",
        subsections: [
          { id: "activity-log", title: "What the log records" },
          { id: "activity-filters", title: "Searching and filtering" },
        ],
      },
      {
        id: "account",
        title: "Account",
        subsections: [
          { id: "account-settings", title: "The Settings page" },
          { id: "account-signin", title: "Signing in and out" },
          { id: "account-sessions", title: "Signed-in browsers" },
          { id: "account-delete", title: "Deleting your account" },
        ],
      },
    ],
  },
  {
    group: "Reference",
    sections: [
      {
        id: "security",
        title: "Security",
        subsections: [
          { id: "security-key", title: "The SSH key and the host key" },
          { id: "security-builds", title: "Where builds run" },
          { id: "security-vars", title: "Variables and secrets" },
          { id: "security-signin", title: "Sign-in and requests" },
          { id: "security-visibility", title: "Who can see what" },
        ],
      },
      {
        id: "selfhost",
        title: "Running your own",
        subsections: [
          { id: "selfhost-start", title: "Starting your own copy" },
          { id: "selfhost-login", title: "Start on login" },
          { id: "selfhost-config", title: "Settings Egg reads" },
          { id: "selfhost-worker", title: "The worker that runs builds" },
          { id: "selfhost-database", title: "The database and backups" },
          { id: "selfhost-apps", title: "Hack Club and GitHub apps" },
          { id: "selfhost-server", title: "Run on a Linux server with Docker Compose" },
          { id: "selfhost-platforms", title: "What works where" },
        ],
      },
      {
        id: "limits",
        title: "Limits",
        subsections: [
          { id: "limits-deploys", title: "Projects and deploys" },
          { id: "limits-container", title: "Container features" },
          { id: "limits-api", title: "Access tokens and the API" },
          { id: "limits-watch", title: "Watching and history" },
          { id: "limits-account", title: "Sign-in" },
        ],
      },
      {
        id: "troubleshooting",
        title: "Troubleshooting",
        subsections: [
          { id: "troubleshooting-connection", title: "Test connection fails" },
          { id: "troubleshooting-build", title: "The build fails" },
          { id: "troubleshooting-no-answer", title: "It built, but the app never answered" },
          { id: "troubleshooting-adopt", title: "A deploy is blocked by something on the container" },
          { id: "troubleshooting-project", title: "A project will not create" },
          { id: "troubleshooting-rollback", title: "A rollback or cancel is refused" },
          { id: "troubleshooting-env", title: "A variable will not save" },
          { id: "troubleshooting-domain", title: "A domain stays on “Needs attention”" },
          { id: "troubleshooting-hook-409", title: "A deploy hook answers 409" },
          { id: "troubleshooting-pr-comment", title: "No comment appears on a pull request" },
          { id: "troubleshooting-alerts", title: "Alerts or notifications do not arrive" },
          { id: "troubleshooting-container", title: "The terminal, files or leftovers are refused" },
          { id: "troubleshooting-token", title: "The API answers 401, 403 or 429" },
          { id: "troubleshooting-signin", title: "Sign-in fails" },
        ],
      },
    ],
  },
];

/** Every section, in reading order. Each one is its own page. */
export const DOCS_SECTIONS: DocsSection[] = DOCS_NAV.flatMap((g) => g.sections);

const SECTION_BY_ID = new Map(DOCS_SECTIONS.map((s) => [s.id, s]));

const SUB_BY_ID = new Map(
  DOCS_SECTIONS.flatMap((s) => s.subsections.map((sub) => [sub.id, { ...sub, sectionId: s.id }] as const))
);

export function sectionTitle(id: string): string {
  const section = SECTION_BY_ID.get(id);
  if (!section) throw new Error(`Unknown docs section: ${id}`);
  return section.title;
}

export function subsectionTitle(id: string): string {
  const sub = SUB_BY_ID.get(id);
  if (!sub) throw new Error(`Unknown docs subsection: ${id}`);
  return sub.title;
}

export function getSection(id: string): DocsSection | undefined {
  return SECTION_BY_ID.get(id);
}

/** The group a section belongs to ("Start", "Use it", ...). */
export function groupOf(id: string): string | undefined {
  return DOCS_NAV.find((g) => g.sections.some((s) => s.id === id))?.group;
}

/** The id of a page's `h1`. */
export function headingId(sectionId: string): string {
  return `${sectionId}-h`;
}

export function docsHref(sectionId: string): string {
  return `/docs/${sectionId}`;
}

/** The page the visitor is on, from the pathname, or null on the docs home. */
export function sectionIdFromPath(pathname: string): string | null {
  const m = /^\/docs\/([^/#?]+)/.exec(pathname);
  return m && SECTION_BY_ID.has(m[1]) ? m[1] : null;
}

/** The pages either side of this one, in reading order, across groups. */
export function neighbors(sectionId: string): { prev: DocsSection | null; next: DocsSection | null } {
  const i = DOCS_SECTIONS.findIndex((s) => s.id === sectionId);
  return {
    prev: i > 0 ? DOCS_SECTIONS[i - 1] : null,
    next: i >= 0 && i < DOCS_SECTIONS.length - 1 ? DOCS_SECTIONS[i + 1] : null,
  };
}

/**
 * Old links pointed at one long page (`/docs#servers`). Given such a hash id,
 * the page it lives on now, so a bookmark still lands in the right place.
 */
export function legacyHref(hashId: string): string | null {
  const id = hashId.replace(/^#/, "");
  if (SECTION_BY_ID.has(id)) return docsHref(id);
  const sub = SUB_BY_ID.get(id);
  if (sub) return `${docsHref(sub.sectionId)}#${id}`;
  if (id.endsWith("-h") && SECTION_BY_ID.has(id.slice(0, -2))) return docsHref(id.slice(0, -2));
  return null;
}
