import { sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { ACCESS_SESSION_COOKIE, accessProtectionConfigSchema, isExcludedAccessPath, verifyAccessPassword, verifyAccessSession } from "@/server/access-protection";
import { getDb } from "@/server/db";

export type IngressProtection = {
  projectId: string;
  mode: "off" | "password" | "basic-auth" | "egg";
  excludedPaths: string[];
};

/** Resolve a deployed hostname, or an explicit project ID, to its saved protection settings. */
export async function resolveIngressProtection(hostname: string, projectId?: string): Promise<IngressProtection | null> {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "").replace(/:\d+$/, "");
  if (!projectId && !host) return null;
  const db = await getDb();
  await db.run(sql`CREATE TABLE IF NOT EXISTS project_access_protection (
    project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    config_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  const row = projectId
    ? await db.get<{ project_id: string; config_json: string }>(sql`
        SELECT p.id AS project_id, a.config_json
        FROM projects p LEFT JOIN project_access_protection a ON a.project_id = p.id
        WHERE p.id = ${projectId}
      `)
    : await db.get<{ project_id: string; config_json: string }>(sql`
        SELECT d.project_id, a.config_json
        FROM domains d
        LEFT JOIN project_access_protection a ON a.project_id = d.project_id
        WHERE lower(d.domain) = ${host} AND d.status = 'valid' AND d.project_id IS NOT NULL
        LIMIT 1
      `);
  if (!row) return null;
  if (!row.config_json) return { projectId: row.project_id, mode: "off", excludedPaths: [] };
  let stored: unknown;
  try { stored = JSON.parse(row.config_json); } catch { throw new Error("Stored project access settings are invalid"); }
  const parsed = accessProtectionConfigSchema.safeParse(stored);
  if (!parsed.success) throw new Error("Stored project access settings are invalid");
  const value = parsed.data;
  return { projectId: row.project_id, mode: value.mode, excludedPaths: value.excludedPaths };
}

function credentialsFromRequest(request: Request | NextRequest) {
  const headers = request.headers;
  let username: string | null = null;
  let password = headers.get("x-egg-access-password");
  const authorization = headers.get("authorization");
  if (authorization?.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
      const separator = decoded.indexOf(":");
      if (separator >= 0) {
        username = decoded.slice(0, separator);
        password = decoded.slice(separator + 1);
      }
    } catch { /* malformed Basic credentials are simply refused */ }
  } else if (!password && authorization?.startsWith("Bearer ")) {
    password = authorization.slice(7);
  }
  const cookie = headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${ACCESS_SESSION_COOKIE}=`));
  return { username, password, session: cookie ? cookie.slice(ACCESS_SESSION_COOKIE.length + 1) : null };
}

/** Check whether an HTTP request has credentials for the resolved project. */
export async function verifyIngressRequest(request: Request | NextRequest, protection: IngressProtection): Promise<boolean> {
  if (protection.mode === "off") return true;
  const pathname = new URL(request.url).pathname;
  if (isExcludedAccessPath(pathname, protection.excludedPaths)) return true;
  const credentials = credentialsFromRequest(request);
  if (protection.mode === "egg") return verifyAccessSession(credentials.session, protection.projectId) !== null;

  const db = await getDb();
  const row = await db.get<{ config_json: string }>(sql`SELECT config_json FROM project_access_protection WHERE project_id = ${protection.projectId}`);
  if (!row) return false;
  let stored: unknown;
  try { stored = JSON.parse(row.config_json); } catch { return false; }
  const parsed = accessProtectionConfigSchema.safeParse(stored);
  if (!parsed.success || parsed.data.mode !== protection.mode || !("passwordHash" in parsed.data) || !credentials.password) return false;
  if (protection.mode === "basic-auth" && (parsed.data.mode !== "basic-auth" || credentials.username !== parsed.data.username)) return false;
  return verifyAccessPassword(credentials.password, parsed.data.passwordHash);
}

