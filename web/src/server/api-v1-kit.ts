import { z } from "zod";
import type { Principal, Scope } from "@/server/api-tokens";
import { HttpError } from "@/server/http";
import { rateLimiter } from "@/server/rate-limit";

/**
 * The pieces every API endpoint is made from: the rate-limit buckets, the
 * `Endpoint` description and the `endpoint()` builder. The endpoint lists
 * (`api-v1.ts` and `api-v1-more.ts`) are written with these, and the HTTP
 * routes, the OpenAPI document and the MCP tools are all generated from them.
 */

// ---------------------------------------------------------------- rate limits

/**
 * `read` and `write` are the two everyday buckets. `ssh` is a small bucket for
 * anything that opens a session to the user's container, or reads a long
 * history, so one token cannot hammer a Nest account. `input` is for terminal
 * keystrokes, which have to be frequent to be usable.
 */
export type Bucket = "read" | "write" | "ssh" | "input";

/** Per token, per minute. */
export const API_LIMITS: Record<Bucket, { limit: number; windowMs: number }> = {
  read: { limit: 120, windowMs: 60_000 },
  write: { limit: 30, windowMs: 60_000 },
  ssh: { limit: 10, windowMs: 60_000 },
  input: { limit: 300, windowMs: 60_000 },
};

/** Count one request for the token's owner in this bucket, or throw 429 with Retry-After. */
export function enforceApiRate(p: Principal, bucket: Bucket): void {
  const { limit, windowMs } = API_LIMITS[bucket];
  const result = rateLimiter().check(`api:${bucket}:${p.userId}`, limit, windowMs);
  if (result.allowed) return;
  const seconds = result.retryAfterSeconds;
  throw new HttpError(
    429,
    `Too many requests. All of your tokens share one budget, so switching tokens will not reset it. Wait ${seconds} second${seconds === 1 ? "" : "s"} and try again.`,
    "rate_limited",
    { "Retry-After": String(seconds) }
  );
}

// -------------------------------------------------------- endpoint descriptions

type Shape = z.ZodRawShape;
type Empty = Record<never, never>;

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type Endpoint = {
  /** The MCP tool name and the OpenAPI operationId. */
  id: string;
  method: HttpMethod;
  /** OpenAPI path template, relative to /api/v1. */
  path: string;
  /** The scope a token needs, or null when any valid token may call it (only `get_me`). */
  scope: Scope | null;
  bucket: Bucket;
  /** Success status. */
  status: 200 | 201 | 202;
  tag:
    | "Account"
    | "Projects"
    | "Deployments"
    | "Logs"
    | "Domains"
    | "Resources"
    | "Environment"
    | "Notifications"
    | "Analytics"
    | "Servers"
    | "Activity"
    | "Terminal"
    | "Files";
  summary: string;
  /** Written for an AI agent: what it does, when to use it, what comes back. */
  description: string;
  pathParams: Shape;
  query: Shape;
  body: Shape;
  /** The whole input, flattened (used by MCP tools and for validation). */
  input: z.ZodObject;
  response: z.ZodType;
  /** Extra error statuses beyond 401, 403 and 429. */
  errors: number[];
  readOnly: boolean;
  destructive: boolean;
  /** Largest JSON request body, in bytes. */
  maxBodyBytes: number;
  /** MCP wraps everything this tool returns — success AND errors — in a
   *  nonce-delimited untrusted frame, so remote bytes cannot pose as trusted
   *  text. Defaults to true. Opt out with `untrusted: false` only when both the
   *  payload and every error are static or strictly validated, with no
   *  container, repository, DNS or other remote bytes. */
  untrusted: boolean;
  run: (p: Principal, input: never) => Promise<unknown>;
};

export const DEFAULT_MAX_BODY_BYTES = 16 * 1024;

export function endpoint<P extends Shape = Empty, Q extends Shape = Empty, B extends Shape = Empty>(def: {
  id: string;
  method: HttpMethod;
  path: string;
  scope: Scope | null;
  bucket: Bucket;
  status?: Endpoint["status"];
  tag: Endpoint["tag"];
  summary: string;
  description: string;
  pathParams?: P;
  query?: Q;
  body?: B;
  response: z.ZodType;
  errors?: number[];
  destructive?: boolean;
  /** Set to false to opt out of the default untrusted framing. See `Endpoint`. */
  untrusted?: boolean;
  maxBodyBytes?: number;
  run: (p: Principal, input: z.output<z.ZodObject<P & Q & B>>) => Promise<unknown>;
}): Endpoint {
  const pathParams = (def.pathParams ?? {}) as P;
  const query = (def.query ?? {}) as Q;
  const body = (def.body ?? {}) as B;
  return {
    id: def.id,
    method: def.method,
    path: def.path,
    scope: def.scope,
    bucket: def.bucket,
    status: def.status ?? 200,
    tag: def.tag,
    summary: def.summary,
    description: def.description,
    pathParams,
    query,
    body,
    input: z.object({ ...query, ...body, ...pathParams }).strict(),
    response: def.response,
    errors: def.errors ?? [],
    readOnly: def.method === "GET",
    destructive: def.destructive ?? false,
    maxBodyBytes: def.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
    untrusted: def.untrusted ?? true,
    run: def.run as Endpoint["run"],
  };
}

export const NOT_FOUND_NOTE = "Returns 404 for an id that does not exist or belongs to someone else.";

// ----------------------------------------------------------- shared id inputs

export const projectIdInput = z.string().trim().min(1).max(100).describe("The project's id, from list_projects.");
export const deploymentIdInput = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .describe("The deployment's id, from list_deployments or a deploy call.");
export const serverIdInput = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .describe("The server's id, from list_servers (or a project's serverId).");
export const domainIdInput = z.string().trim().min(1).max(100).describe("The domain's id, from list_domains.");

/** A true/false flag that works as a JSON boolean (MCP) and as ?flag=true (REST). */
export const flagInput = z.union([z.boolean(), z.enum(["true", "false"]).transform((v) => v === "true")]);

/** Maximum serialized size for any API response that contains log lines. */
export const MAX_LOG_RESPONSE_BYTES = 40 * 1024;

/**
 * Clip log text as needed so logs stay within the API response budget while
 * retaining every line's position and paging metadata.
 */
export function capLogResponse<T extends string | { message: string }, F extends Record<string, unknown>>(
  fields: F,
  lines: T[],
): F & { lines: T[]; truncated: boolean } {
  const messageOf = (line: T) => (typeof line === "string" ? line : (line as { message: string }).message);
  const withMessage = (line: T, message: string): T => {
    if (typeof line === "string") return message as T;
    return { ...(line as { message: string }), message } as T;
  };
  const response = (candidate: T[], truncated: boolean) => ({ ...fields, lines: candidate, truncated });
  const size = (candidate: T[], truncated: boolean) =>
    Buffer.byteLength(JSON.stringify(response(candidate, truncated)), "utf8");

  if (size(lines, false) <= MAX_LOG_RESPONSE_BYTES) {
    return response(lines, false);
  }

  let low = 0;
  let high = 1;
  let best = lines.map((line) => withMessage(line, ""));
  for (let attempt = 0; attempt < 24; attempt++) {
    const ratio = (low + high) / 2;
    const candidate = lines.map((line) => {
      const text = messageOf(line);
      return withMessage(line, text.slice(0, Math.floor(text.length * ratio)));
    });
    if (size(candidate, true) <= MAX_LOG_RESPONSE_BYTES) {
      best = candidate;
      low = ratio;
    } else {
      high = ratio;
    }
  }

  return response(best, true);
}
