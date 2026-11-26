import { REPO_URL } from "@/lib/site";
import { timeAgo } from "@/lib/status";

/**
 * Pure helpers for the Developer page: expiry wording, the copy-paste
 * snippets and the fixed copy. Nothing here touches the server or the DOM.
 */

const DAY = 86_400_000;

/** How many active tokens one person can hold. Mirrors the limit in server/api-tokens.ts. */
export const ACTIVE_TOKEN_LIMIT = 25;
export const NAME_MAX_LENGTH = 60;

export const EXPIRY_OPTIONS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "365 days" },
] as const;
export const DEFAULT_EXPIRY_DAYS = 90;

/** The permission that can start builds. The form marks it so nobody ticks it by accident. */
export const DEPLOY_SCOPE = "deployments:write";

/**
 * Permissions that act on the container itself. A token that holds one expires
 * within `SHORT_LIVED_DAYS`. Mirrors SHORT_LIVED_SCOPES in server/api-tokens.ts,
 * which enforces it (a test keeps the two equal).
 */
export const SHORT_LIVED_SCOPES: readonly string[] = ["terminal:use", "files:write"];
export const SHORT_LIVED_DAYS = 7;

export const holdsShortLived = (scopes: readonly string[]) => scopes.some((s) => SHORT_LIVED_SCOPES.includes(s));

/** Permissions that change something. The checklist marks them. */
export const isChangeScope = (id: string) => id.endsWith(":write") || id === "terminal:use";

/** The badge on a permission that can change things. */
export function scopeBadge(id: string): string | null {
  if (id === DEPLOY_SCOPE) return "Can start builds";
  if (id === "terminal:use") return "Runs commands";
  if (id === "files:write") return "Changes files";
  if (id === "projects:write") return "Can change or delete projects";
  return isChangeScope(id) ? "Can change things" : null;
}

/** Extra words under a permission, for the ones that need more than their label. */
export function scopeNote(id: string): string | null {
  if (id === "terminal:use") {
    return "Needs the terminal switched on for the server. You turned it on with a recent Hack Club sign-in, and a token can use it until its 7 days end or you switch it off. The token does not sign in again.";
  }
  if (id === "files:write") {
    return "Needs file changes switched on for the server, with the same recent sign-in rule. Only the shared/ folder can change, never the live release.";
  }
  return null;
}

export const SHORT_LIVED_NOTE =
  "A token with the terminal or file change permission expires in 7 days at most, so a lost token stops working soon.";

export type TokenStatus = "active" | "expired" | "revoked";
export const STATUS_LABEL: Record<TokenStatus, string> = {
  active: "Active",
  expired: "Expired",
  revoked: "Revoked",
};

type Dated = { revokedAt: string | null; expiresAt: string };

/** Revoked wins over expired: a revoked token never comes back. */
export function tokenStatus(t: Dated, now = Date.now()): TokenStatus {
  if (t.revokedAt) return "revoked";
  return new Date(t.expiresAt).getTime() > now ? "active" : "expired";
}

/** Only an active token can be revoked from the list. */
export const canRevoke = (t: Dated, now = Date.now()) => tokenStatus(t, now) === "active";

/** Only an active token can be edited. A revoked one is final; an expired one is left alone. */
export const canEdit = canRevoke;

/** What the editor's expiry select holds: leave it as is, or a number of days from now. */
export type ExpiryChoice = "keep" | (typeof EXPIRY_OPTIONS)[number]["days"];

export type TokenEdit = { name: string; scopes: readonly string[]; expiry: ExpiryChoice };
export type TokenPatch = { name?: string; scopes?: string[]; expiresInDays?: number };

/**
 * Only the fields that differ from the token, so an untouched editor sends
 * nothing and an edit never resets an expiry by accident. Scope order is not a
 * change.
 */
export function buildTokenPatch(token: { name: string; scopes: readonly string[] }, edit: TokenEdit): TokenPatch {
  const patch: TokenPatch = {};
  const name = edit.name.trim();
  if (name !== token.name) patch.name = name;
  const same = edit.scopes.length === token.scopes.length && edit.scopes.every((s) => token.scopes.includes(s));
  if (!same) patch.scopes = [...edit.scopes];
  if (edit.expiry !== "keep") patch.expiresInDays = edit.expiry;
  return patch;
}

/** The expiry choices that are allowed for these permissions: 7 days only when a container permission is picked. */
export function allowedExpiries(scopes: readonly string[]) {
  return holdsShortLived(scopes) ? EXPIRY_OPTIONS.filter((o) => o.days <= SHORT_LIVED_DAYS) : EXPIRY_OPTIONS;
}

/** The expiry a new token will really get: the chosen days, cut to 7 when a container permission is picked. */
export function clampExpiry(days: number, scopes: readonly string[]): number {
  return holdsShortLived(scopes) ? Math.min(days, SHORT_LIVED_DAYS) : days;
}

/**
 * The expiry an edit will really send. "Keep" is only allowed while the token
 * already ends within 7 days; otherwise a container permission forces 7 days.
 */
export function clampEditExpiry(
  choice: ExpiryChoice,
  scopes: readonly string[],
  token: { expiresAt: string },
  now = Date.now()
): ExpiryChoice {
  if (!holdsShortLived(scopes)) return choice;
  if (choice === "keep") return new Date(token.expiresAt).getTime() > now + SHORT_LIVED_DAYS * DAY ? 7 : "keep";
  return choice > SHORT_LIVED_DAYS ? 7 : choice;
}

/** True when the edit removes the permission that starts builds. */
export function dropsDeployAccess(before: readonly string[], after: readonly string[]): boolean {
  return before.includes(DEPLOY_SCOPE) && !after.includes(DEPLOY_SCOPE);
}

export const DEPLOY_DROP_NOTE =
  "Deploys will stop working for anything that uses this token, including redeploys, cancels and rollbacks.";

const MONTHS =["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "5 Nov 2026", in UTC so the same instant reads the same everywhere. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "Never" until the token has been used once. */
export function lastUsedLabel(iso: string | null, now = Date.now()): string {
  return iso ? timeAgo(iso, now) : "Never";
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * When a token stops working, in words: "In 12 days", "Tomorrow", "Today",
 * "3 days ago". A revoked token shows the date it was due, since its end was
 * the revoke, not the date.
 */
export function expiryLabel(t: Dated, now = Date.now()): string {
  if (t.revokedAt) return formatDate(t.expiresAt);
  const diff = new Date(t.expiresAt).getTime() - now;
  if (diff > 0) {
    const days = Math.ceil(diff / DAY);
    if (days <= 1) return "Today";
    if (days === 2) return "Tomorrow";
    return `In ${plural(days, "day")}`;
  }
  const ago = Math.floor(-diff / DAY);
  if (ago < 1) return "Today";
  if (ago === 1) return "Yesterday";
  return `${plural(ago, "day")} ago`;
}

/** Tokens that can still be used, for the limit note. */
export function activeCount(tokens: Dated[], now = Date.now()): number {
  return tokens.filter((t) => tokenStatus(t, now) === "active").length;
}

export function limitNote(active: number): string {
  if (active >= ACTIVE_TOKEN_LIMIT) {
    return `You have ${ACTIVE_TOKEN_LIMIT} active tokens, the most allowed. Revoke one to create another.`;
  }
  return `${active} of ${ACTIVE_TOKEN_LIMIT} active tokens used. Revoked and expired tokens do not count.`;
}

// ---- copy -----------------------------------------------------------------

export const SECRET_NOTE = "Copy it now. It will not be shown again.";

/** What a token cannot do at all. Matches what the API and the agent endpoint refuse. */
export const TOKEN_CANNOT = [
  "Remove leftovers.",
  "Change container permissions.",
  "Manage your account, your sessions or other tokens.",
] as const;

/** What a token can do only under tight limits. */
export const TOKEN_LIMITED = [
  "Use the terminal, only if you switched it on for that server, and only for 7 days at most.",
  "Change files, only in a project's shared/ folder, only if you switched file changes on, and only for 7 days at most.",
] as const;

export const TOKEN_PLACEHOLDER = "ndp_...";

const trimSlash = (origin: string) => origin.replace(/\/+$/, "");

export const apiBase = (origin: string) => `${trimSlash(origin)}/api/v1`;
export const openApiUrl = (origin: string) => `${apiBase(origin)}/openapi.json`;
export const mcpUrl = (origin: string) => `${trimSlash(origin)}/api/mcp`;

/** A one-line request that lists projects. The token is a placeholder, never a real one. */
export function curlExample(origin: string): string {
  return `curl -H "Authorization: Bearer ${TOKEN_PLACEHOLDER}" ${apiBase(origin)}/projects`;
}

/** Config for an MCP client that connects over HTTP and sends the token as a bearer header. */
export function mcpConfigSnippet(origin: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        "nest-deploy": {
          type: "http",
          url: mcpUrl(origin),
          headers: { Authorization: `Bearer ${TOKEN_PLACEHOLDER}` },
        },
      },
    },
    null,
    2
  );
}

// ---- build with it ----------------------------------------------------------

export type BuildResource = {
  id: string;
  title: string;
  summary: string;
  /** Path inside the repository. */
  path: string;
  /** Token permissions it needs. Empty when it needs no token. */
  scopes: readonly string[];
  /** Said instead of a scope list when `scopes` is empty. */
  noScopeNote?: string;
};

/** The ready-made examples and the typed client. Each says which permissions its token needs. */
export const BUILD_RESOURCES: readonly BuildResource[] = [
  {
    id: "sdk",
    title: "TypeScript client",
    summary: "One file, no dependencies. Typed methods for projects, deployments, logs, domains, environment names, analytics, usage, alerts and the status page. Runs on Node 20 and in the browser.",
    path: "web/src/lib/sdk/nest-deploy.ts",
    scopes: [],
    noScopeNote: "Depends on the method. Each one names its permission.",
  },
  {
    id: "node",
    title: "Node script",
    summary: "Lists your projects and follows a build log until it finishes.",
    path: "examples/node/tail-logs.mjs",
    scopes: ["projects:read", "deployments:read"],
  },
  {
    id: "python",
    title: "Python script",
    summary: "The same, with only the standard library.",
    path: "examples/python/tail_logs.py",
    scopes: ["projects:read", "deployments:read"],
  },
  {
    id: "dashboard",
    title: "Static dashboard",
    summary: "One HTML file. Paste a token and see your projects and page views. The token stays in the page's memory and is never saved.",
    path: "examples/dashboard/index.html",
    scopes: ["projects:read", "analytics:read"],
  },
  {
    id: "actions",
    title: "GitHub Actions workflow",
    summary: "Deploys when you publish a release, through a deploy hook.",
    path: "examples/github-actions/deploy-on-release.yml",
    scopes: [],
    noScopeNote: "No token. It uses the project's deploy hook URL.",
  },
  {
    id: "mcp",
    title: "MCP config",
    summary: "Connect Claude Desktop, Cursor or Claude Code to your projects.",
    path: "examples/mcp",
    scopes: [],
    noScopeNote: "Whatever you want the agent to do. The first call, get_me, needs none.",
  },
];

/** "Needs projects:read and deployments:read", or the resource's own note. */
export function scopeNeeds(r: BuildResource): string {
  if (r.scopes.length === 0) return r.noScopeNote ?? "No permission needed.";
  const list = r.scopes.length === 1 ? r.scopes[0] : `${r.scopes.slice(0, -1).join(", ")} and ${r.scopes[r.scopes.length - 1]}`;
  return `Needs ${list}.`;
}

/** Where a path in the repository can be read. */
export const repoLink = (path: string) => `${REPO_URL}/${path.includes(".") ? "blob" : "tree"}/main/${path}`;

/** The first call a script or agent should make. It needs no permission. */
export function meExample(origin: string): string {
  return `curl -H "Authorization: Bearer ${TOKEN_PLACEHOLDER}" ${apiBase(origin)}/me`;
}

/** A first program with the TypeScript client. The token comes from the environment. */
export function sdkExample(origin: string): string {
  return [
    'import { NestDeploy } from "./nest-deploy";',
    "",
    "const nest = new NestDeploy({",
    "  token: process.env.NEST_TOKEN!,",
    `  baseUrl: "${trimSlash(origin)}",`,
    "});",
    "",
    "const me = await nest.me();",
    "console.log(me.token.scopes);",
    "",
    "const { projects } = await nest.listProjects();",
    "for (const p of projects) console.log(p.name, p.state);",
  ].join("\n");
}

/** Pull the first error out of an unknown thrown value, for inline display. */
export function errorText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}
