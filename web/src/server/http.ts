import { unstable_rethrow } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { getCurrentUser } from "@/server/auth/current";
import type { SessionUser } from "@/server/auth/session";
import { readJsonLimited } from "@/server/body-limit";
import { config } from "@/server/config";
import { measureBackendRequest } from "@/server/backend-metrics";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = "error",
    /** Extra response headers, such as Retry-After on a 429. */
    readonly headers?: Record<string, string>
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const notFound = (what = "Not found") => new HttpError(404, what, "not_found");

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

/** Resolve the signed-in user or fail with 401. */
export async function authed(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new HttpError(401, "Sign in required", "unauthorized");
  return user;
}

export async function readJson<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  const body = await readJsonLimited(req);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw zodToHttp(parsed.error);
  return parsed.data;
}

export function zodToHttp(err: ZodError) {
  const first = err.issues[0];
  const where = first?.path.length ? `${first.path.join(".")}: ` : "";
  return new HttpError(400, `${where}${first?.message ?? "Invalid input"}`, "validation");
}

/**
 * Browsers attach Origin to cross-site writes. Reject writes whose Origin is
 * not our own, on top of SameSite=Lax cookies. A write with no Origin is let
 * through for curl and webhooks, unless the browser's own Sec-Fetch-Site header
 * says it came from another site.
 */
export function assertSameOrigin(req: NextRequest) {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
  const origin = req.headers.get("origin");
  if (!origin) {
    // Non-browser clients (curl, webhooks) send neither header.
    const site = req.headers.get("sec-fetch-site");
    if (site === "cross-site" || site === "same-site") {
      throw new HttpError(403, "Cross-origin request blocked", "csrf");
    }
    return;
  }
  const allowed = new URL(config().APP_URL).origin;
  if (origin !== allowed && origin !== req.nextUrl.origin) {
    throw new HttpError(403, "Cross-origin request blocked", "csrf");
  }
}

type Handler<C> = (req: NextRequest, ctx: C) => Promise<Response>;

/** Route-layer backstop. Bearer APIs never inherit the browser's identity. */
async function enforceRequestMaintenance(req: NextRequest) {
  const { maintenanceExemptRequest, maintenanceState, maintenanceError } = await import("@/server/maintenance");
  const path = new URL(req.url).pathname;
  if (maintenanceExemptRequest(path, req.method.toUpperCase()) || !(await maintenanceState()).active) return;
  let userId: string | null = null;
  if (path.startsWith("/api/v1/")) {
    const { bearerFrom, principalFor } = await import("@/server/api-tokens");
    userId = (await principalFor(bearerFrom(req)))?.userId ?? null;
  } else {
    userId = (await getCurrentUser())?.id ?? null;
  }
  const { isInstanceAdmin } = await import("@/server/admin-identity");
  if (!(await isInstanceAdmin(userId))) throw maintenanceError();
}

/** Suspended accounts after their grace period: the account's own writes are refused, reads are not. */
async function enforceAccountWrites(req: NextRequest) {
  const { accountExemptRequest, assertAccountCanWrite } = await import("@/server/account-standing");
  const path = new URL(req.url).pathname;
  if (accountExemptRequest(path, req.method.toUpperCase())) return;
  let userId: string | null = null;
  if (path.startsWith("/api/v1/")) {
    const { bearerFrom, principalFor } = await import("@/server/api-tokens");
    userId = (await principalFor(bearerFrom(req)))?.userId ?? null;
  } else {
    userId = (await getCurrentUser())?.id ?? null;
  }
  if (userId) await assertAccountCanWrite(userId);
}

/** Wrap a route handler: same-origin check plus uniform JSON errors. */
export function handle<C = unknown>(
  fn: Handler<C>,
  options: { skipOriginCheck?: boolean } = {}
): Handler<C> {
  return async (req, ctx) => measureBackendRequest(new URL(req.url).pathname, async () => {
    try {
      if (!options.skipOriginCheck) assertSameOrigin(req);
      await enforceRequestMaintenance(req);
      await enforceAccountWrites(req);
      return await fn(req, ctx);
    } catch (err) {
      // Let Next.js control-flow errors (dynamic-API bailouts, redirects) through.
      unstable_rethrow(err);
      if (err instanceof HttpError) {
        return NextResponse.json(
          { error: { code: err.code, message: err.message } },
          { status: err.status, headers: err.headers }
        );
      }
      if (err instanceof ZodError) {
        const e = zodToHttp(err);
        return NextResponse.json(
          { error: { code: e.code, message: e.message } },
          { status: 400 }
        );
      }
      console.error("Unhandled API error", err);
      return NextResponse.json(
        { error: { code: "internal", message: "Something went wrong on our side." } },
        { status: 500 }
      );
    }
  });
}
