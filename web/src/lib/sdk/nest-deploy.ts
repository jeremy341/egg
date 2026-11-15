/**
 * A small client for the Nest Deploy API, in one file with no dependencies.
 * Copy this file into your own project, or import it from here.
 *
 *   const nest = new NestDeploy({ token: process.env.NEST_TOKEN!, baseUrl: "https://your-nest-deploy" });
 *   const { projects } = await nest.listProjects();
 *
 * It runs on Node 20+ and in the browser, using the global `fetch`. Pass your
 * own `fetch` to test it with a fake. Every failure is a `NestDeployError` with a
 * `status`, a `code` and a `message`; the token is never put in an error.
 *
 * Which token permission each method needs is written on the method.
 */

// ------------------------------------------------------------------ transport

/** The slice of `Response` this client uses, so a fake is easy to write. */
export type FetchResponse = {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
};

export type FetchInit = {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
};

export type FetchLike = (url: string, init: FetchInit) => Promise<FetchResponse>;

export type NestDeployOptions = {
  /** A personal access token (starts with `ndp_`), created on the Developer page. */
  token: string;
  /** Your Nest Deploy address, such as `https://deploy.example.com`. `/api/v1` is added for you. */
  baseUrl: string;
  /** Defaults to the global `fetch`. */
  fetch?: FetchLike;
  /** Give up on one request after this many milliseconds. Default 30000. */
  timeoutMs?: number;
};

/** Every failure: an API error answer, a network failure (status 0), or an answer that is not JSON. */
export class NestDeployError extends Error {
  readonly status: number;
  readonly code: string;
  /** Set on a 429: how many seconds the server asked you to wait. */
  readonly retryAfterSeconds: number | null;

  constructor(status: number, code: string, message: string, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = "NestDeployError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

// ---------------------------------------------------------------------- types

export type DeployState = "queued" | "building" | "deploying" | "ready" | "error" | "canceled";

export type Me = {
  user: { name: string };
  token: { name: string; scopes: string[]; expiresAt: string };
  counts: { servers: number; projects: number };
};

export type DeploymentSummary = {
  id: string;
  env: "production" | "preview";
  state: DeployState;
  branch: string;
  sha: string | null;
  commit: string | null;
  author: string | null;
  createdAt: string;
  durationMs: number | null;
};

export type Project = {
  id: string;
  slug: string;
  name: string;
  repo: string | null;
  branch: string;
  runtime: string;
  port: number;
  startCommand: string | null;
  healthPath: string;
  autoDeploy: boolean;
  serverId: string;
  monitor: "unknown" | "up" | "down";
  state: DeployState | null;
  latestDeployment: DeploymentSummary | null;
};

export type Deployment = DeploymentSummary & {
  projectId: string;
  projectSlug: string;
  source: string;
  pr: number | null;
  isCurrent: boolean;
  cleanedUp: boolean;
  error: string | null;
};

export type DeploymentDetail = Deployment & {
  startedAt: string | null;
  finishedAt: string | null;
  port: number;
};

export type LogLine = { id: number; at: string; level: "info" | "warn" | "error"; message: string };

export type DeploymentLogPage = {
  deploymentId: string;
  lines: LogLine[];
  /** Pass as `after` to continue. */
  nextAfter: number;
  /** True when the page was full, so there may be more. */
  more: boolean;
};

export type Domain = {
  id: string;
  domain: string;
  status: "pending" | "valid" | "invalid";
  port: number;
  projectId: string | null;
  projectName: string | null;
  serverId: string;
  cname: string | null;
};

/** Names only. Values are never returned by the API. */
export type EnvName = { key: string; target: "all" | "production" | "preview" };

export type Analytics = {
  days: number;
  views: number;
  visitors: number;
  daily: { day: string; views: number; visitors: number }[];
  pages: { path: string; views: number }[];
  referrers: { host: string; views: number }[];
};

export type UsagePoint = { at: string; cpu: number | null; mem: number | null; disk: number | null };
export type UsageHistory = { serverId: string; hours: number; sampled: boolean; points: UsagePoint[] };

export type AlertSettings = {
  diskPct: number;
  memoryPct: number;
  cpuPct: number;
  failuresBeforeDown: number;
  slowMs: number | null;
  channels: { down: boolean; recovery: boolean; resource: boolean; deploy: boolean };
  mute: { active: boolean; forever: boolean; until: string | null };
};
export type AlertEvent = {
  id: string;
  type: "down" | "cpu" | "memory" | "disk" | "deploy";
  message: string;
  firedAt: string;
  resolvedAt: string | null;
  muted: boolean;
};
export type Alerts = { settings: AlertSettings; history: AlertEvent[] };

export type StatusPage = { published: boolean; url: string | null };

export type ActivityItem = {
  id: number;
  action: string;
  kind: string;
  label: string;
  target: { name: string; gone: boolean } | null;
  suffix: string | null;
  fields: { label: string; value: string }[];
  viaToken: { name: string | null } | null;
  tone: "neutral" | "good" | "bad";
  at: string;
};
export type ActivityPage = { items: ActivityItem[]; nextCursor: string | null; total: number | null };
export type ActivityQuery = { kind?: string; range?: string; limit?: number; cursor?: string };

export type Server = {
  id: string;
  nestUsername: string;
  host: string;
  status: "pending" | "connected" | "error";
  lastCheckedAt: string | null;
  createdAt: string;
};

// --------------------------------------------------------------------- client

const DEFAULT_TIMEOUT_MS = 30_000;
const seg = encodeURIComponent;

type Query = Record<string, string | number | undefined>;

function queryString(query: Query): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) parts.push(`${seg(k)}=${seg(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

/** `https://host/` and `https://host/api/v1` both become `https://host/api/v1`. */
function apiRoot(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "").replace(/\/api\/v1$/, "");
  return `${trimmed}/api/v1`;
}

function retryAfter(res: FetchResponse): number | null {
  const n = Number(res.headers.get("retry-after"));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function errorFrom(res: FetchResponse, text: string): NestDeployError {
  const wait = retryAfter(res);
  try {
    const e = (JSON.parse(text) as { error?: { code?: unknown; message?: unknown } }).error;
    if (e && typeof e.message === "string") {
      return new NestDeployError(res.status, typeof e.code === "string" ? e.code : "http_error", e.message, wait);
    }
  } catch {
    // Not JSON: fall through to the generic message.
  }
  return new NestDeployError(res.status, "http_error", `The server answered ${res.status}.`, wait);
}

export class NestDeploy {
  private readonly token: string;
  private readonly root: string;
  private readonly doFetch: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: NestDeployOptions) {
    if (!options.token || !options.token.trim()) {
      throw new NestDeployError(0, "missing_token", "Pass a personal access token (it starts with ndp_).");
    }
    if (!options.baseUrl || !options.baseUrl.trim()) {
      throw new NestDeployError(0, "missing_base_url", "Pass the address of your Nest Deploy, such as https://deploy.example.com.");
    }
    const global = (globalThis as { fetch?: FetchLike }).fetch;
    const chosen = options.fetch ?? (typeof global === "function" ? global.bind(globalThis) : undefined);
    if (!chosen) {
      throw new NestDeployError(0, "no_fetch", "No fetch is available here. Pass one as the fetch option.");
    }
    this.token = options.token.trim();
    this.root = apiRoot(options.baseUrl);
    this.doFetch = chosen;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async request<T>(method: string, path: string, query: Query = {}, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}`, Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null;
    let res: FetchResponse;
    let text: string;
    try {
      res = await this.doFetch(`${this.root}${path}${queryString(query)}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller?.signal,
      });
      text = await res.text();
    } catch {
      const timedOut = controller?.signal.aborted === true;
      throw new NestDeployError(
        0,
        timedOut ? "timeout" : "network_error",
        timedOut ? `No answer within ${Math.round(this.timeoutMs / 1000)} seconds.` : "Could not reach Nest Deploy."
      );
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (!res.ok) throw errorFrom(res, text);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new NestDeployError(res.status, "bad_response", "The server answered with something that is not JSON.");
    }
  }

  // ------------------------------------------------------------------ account

  /** Who this token is, its scopes and expiry. Needs no scope: any valid token. */
  me(): Promise<Me> {
    return this.request("GET", "/me");
  }

  /** Servers (Nest accounts) with their status. Needs `container:read`. */
  listServers(): Promise<{ servers: Server[] }> {
    return this.request("GET", "/servers");
  }

  // ----------------------------------------------------------------- projects

  /** Needs `projects:read`. */
  listProjects(): Promise<{ projects: Project[] }> {
    return this.request("GET", "/projects");
  }

  /** Needs `projects:read`. */
  getProject(projectId: string): Promise<{ project: Project }> {
    return this.request("GET", `/projects/${seg(projectId)}`);
  }

  /** Whether the public status page is published, and its address. Needs `projects:read`. */
  getStatusPage(projectId: string): Promise<{ statusPage: StatusPage }> {
    return this.request("GET", `/projects/${seg(projectId)}/status-page`);
  }

  // -------------------------------------------------------------- deployments

  /** Newest first, 1 to 100 (default 20). Needs `deployments:read`. */
  listDeployments(projectId: string, options: { limit?: number } = {}): Promise<{ deployments: Deployment[] }> {
    return this.request("GET", `/projects/${seg(projectId)}/deployments`, { limit: options.limit });
  }

  /** Needs `deployments:read`. */
  getDeployment(deploymentId: string): Promise<{ deployment: DeploymentDetail }> {
    return this.request("GET", `/deployments/${seg(deploymentId)}`);
  }

  /** Queue a deployment of a branch (default: the production branch). Needs `deployments:write`. */
  deploy(projectId: string, options: { branch?: string } = {}): Promise<{ deployment: Deployment }> {
    return this.request("POST", `/projects/${seg(projectId)}/deployments`, {}, options.branch ? { branch: options.branch } : {});
  }

  /** Build the same commit again. Needs `deployments:write`. */
  redeploy(deploymentId: string): Promise<{ deployment: Deployment }> {
    return this.request("POST", `/deployments/${seg(deploymentId)}/redeploy`);
  }

  /** Cancel a deployment that is still queued, building or deploying. Needs `deployments:write`. */
  cancelDeployment(deploymentId: string): Promise<{ deployment: Deployment }> {
    return this.request("POST", `/deployments/${seg(deploymentId)}/cancel`);
  }

  /** Point production back at an earlier deployment. Changes what is live. Needs `deployments:write`. */
  rollback(deploymentId: string): Promise<{ deployment: Deployment }> {
    return this.request("POST", `/deployments/${seg(deploymentId)}/rollback`);
  }

  // --------------------------------------------------------------------- logs

  /** The newest runtime log lines, oldest first, 1 to 1000 (default 200). Needs `logs:read`. */
  getLogs(projectId: string, options: { lines?: number } = {}): Promise<{ projectId: string; lines: string[] }> {
    return this.request("GET", `/projects/${seg(projectId)}/logs`, { lines: options.lines });
  }

  /** One page of a deployment's build output. Pass the previous `nextAfter` as `after`. Needs `deployments:read`. */
  getDeploymentLogs(deploymentId: string, options: { after?: number; limit?: number } = {}): Promise<DeploymentLogPage> {
    return this.request("GET", `/deployments/${seg(deploymentId)}/logs`, { after: options.after, limit: options.limit });
  }

  /**
   * Every build log line of a deployment, page by page, until a page is not full.
   * To follow a build that is still running, call it again from the last line's
   * id: `nest.deploymentLogLines(id, { after })`.
   */
  async *deploymentLogLines(
    deploymentId: string,
    options: { after?: number; pageSize?: number } = {}
  ): AsyncGenerator<LogLine, void, undefined> {
    let after = options.after ?? 0;
    for (;;) {
      const page = await this.getDeploymentLogs(deploymentId, { after, limit: options.pageSize });
      for (const line of page.lines) yield line;
      if (!page.more || page.nextAfter === after) return;
      after = page.nextAfter;
    }
  }

  // ------------------------------------------------------------------ domains

  /** Needs `domains:read`. */
  listDomains(): Promise<{ domains: Domain[] }> {
    return this.request("GET", "/domains");
  }

  // ---------------------------------------------------------------------- env

  /** Variable names and targets. Values are never returned. Needs `env:read`. */
  listEnvNames(projectId: string): Promise<{ env: EnvName[] }> {
    return this.request("GET", `/projects/${seg(projectId)}/env`);
  }

  // --------------------------------------------------------------- monitoring

  /** Page views over the last 1 to 90 days (default 30). Needs `analytics:read`. */
  getAnalytics(projectId: string, options: { days?: number } = {}): Promise<{ analytics: Analytics }> {
    return this.request("GET", `/projects/${seg(projectId)}/analytics`, { days: options.days });
  }

  /** CPU, memory and disk samples for a server over the last 1 to 168 hours (default 24). Needs `resources:read`. */
  getUsageHistory(serverId: string, options: { hours?: number } = {}): Promise<UsageHistory> {
    return this.request("GET", `/servers/${seg(serverId)}/usage/history`, { hours: options.hours });
  }

  /** Alert thresholds and the last 50 alert events. Needs `alerts:read`. */
  getAlerts(projectId: string): Promise<Alerts> {
    return this.request("GET", `/projects/${seg(projectId)}/alerts`);
  }

  // ----------------------------------------------------------------- activity

  /** One page of the activity log, newest first. Needs `activity:read`. */
  getActivity(query: ActivityQuery = {}): Promise<ActivityPage> {
    return this.request("GET", "/activity", { kind: query.kind, range: query.range, limit: query.limit, cursor: query.cursor });
  }

  /** Every activity entry that matches, page by page, following `nextCursor`. */
  async *activityItems(query: Omit<ActivityQuery, "cursor"> = {}): AsyncGenerator<ActivityItem, void, undefined> {
    let cursor: string | undefined;
    do {
      const page = await this.getActivity({ ...query, cursor });
      for (const item of page.items) yield item;
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
  }
}
