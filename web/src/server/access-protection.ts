import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { config } from "@/server/config";
import { sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import { getProjectForUser } from "@/server/projects";
import { HttpError } from "@/server/http";

export const ACCESS_SESSION_COOKIE = "egg_access";
export const ACCESS_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const KEY_BYTES = 64;

const excludedPath = z.string().trim().min(1).max(300).refine((path) => path.startsWith("/"), "Excluded paths must start with /");

/** Public access settings. A password is accepted only as input and never returned. */
export const accessProtectionConfigSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("off"), excludedPaths: z.array(excludedPath).max(100).default([]) }).strict(),
  z.object({ mode: z.literal("password"), passwordHash: z.string().min(1), excludedPaths: z.array(excludedPath).max(100).default([]) }).strict(),
  z.object({ mode: z.literal("basic-auth"), username: z.string().trim().min(1).max(128), passwordHash: z.string().min(1), excludedPaths: z.array(excludedPath).max(100).default([]) }).strict(),
  z.object({ mode: z.literal("egg"), excludedPaths: z.array(excludedPath).max(100).default([]) }).strict(),
]);
export type AccessProtectionConfig = z.infer<typeof accessProtectionConfigSchema>;

export const accessSettingsInput = z.object({
  mode: z.enum(["open", "password", "sign_in", "basic-auth"]),
  excludedPaths: z.array(excludedPath).max(100),
  password: z.string().max(256).optional(),
}).strict();
export type AccessSettingsView = { mode: "open" | "password" | "sign_in" | "basic-auth"; excludedPaths: string[]; passwordSet: boolean };

async function accessTable() {
  const db = await getDb();
  await db.run(sql`CREATE TABLE IF NOT EXISTS project_access_protection (
    project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    config_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  return db;
}

/** Publicly safe mode lookup used only by the Egg sign-in callback. */
export async function getProjectAccessMode(projectId: string): Promise<AccessSettingsView["mode"]> {
  const db = await accessTable();
  const row = await db.get<{ config_json: string }>(sql`SELECT config_json FROM project_access_protection WHERE project_id = ${projectId}`);
  if (!row) return "open";
  let stored: unknown;
  try { stored = JSON.parse(row.config_json); } catch { throw new Error("Stored project access settings are invalid"); }
  const parsed = accessProtectionConfigSchema.safeParse(stored);
  if (!parsed.success) throw new Error("Stored project access settings are invalid");
  return parsed.data.mode === "off" ? "open" : parsed.data.mode === "egg" ? "sign_in" : parsed.data.mode;
}

/** Owner-only settings view; credential material is never returned. */
export async function getAccessSettings(userId: string, projectId: string): Promise<AccessSettingsView> {
  const project = await getProjectForUser(userId, projectId);
  const db = await accessTable();
  const row = await db.get<{ config_json: string }>(sql`SELECT config_json FROM project_access_protection WHERE project_id = ${project.id}`);
  if (!row) return { mode: "open", excludedPaths: [], passwordSet: false };
  let stored: unknown;
  try { stored = JSON.parse(row.config_json); } catch { throw new Error("Stored project access settings are invalid"); }
  const parsed = accessProtectionConfigSchema.safeParse(stored);
  if (!parsed.success) throw new Error("Stored project access settings are invalid");
  const value = parsed.data;
  return {
    mode: value.mode === "off" ? "open" : value.mode === "egg" ? "sign_in" : value.mode,
    excludedPaths: value.excludedPaths,
    passwordSet: "passwordHash" in value,
  };
}

/** Validate and persist project access settings, hashing new passwords before storage. */
export async function saveAccessSettings(userId: string, projectId: string, raw: unknown): Promise<AccessSettingsView> {
  const input = accessSettingsInput.safeParse(raw);
  if (!input.success) throw new HttpError(400, input.error.issues[0]?.message ?? "Invalid access settings", "validation");
  const project = await getProjectForUser(userId, projectId);
  const db = await accessTable();
  const row = await db.get<{ config_json: string }>(sql`SELECT config_json FROM project_access_protection WHERE project_id = ${project.id}`);
  let stored: unknown;
  if (row) {
    try { stored = JSON.parse(row.config_json); } catch { throw new Error("Stored project access settings are invalid"); }
  }
  const previous = row ? accessProtectionConfigSchema.safeParse(stored) : null;
  if (row && previous && !previous.success) throw new Error("Stored project access settings are invalid");
  let passwordHash: string | undefined;
  if (input.data.mode === "password") {
    if (input.data.password) passwordHash = await hashAccessPassword(input.data.password);
    else if (previous?.success && "passwordHash" in previous.data) passwordHash = previous.data.passwordHash;
    if (!passwordHash) throw new HttpError(400, "Set a password for shared-password mode.", "validation");
  }
  let next: AccessProtectionConfig;
  if (input.data.mode === "open") next = { mode: "off", excludedPaths: input.data.excludedPaths };
  else if (input.data.mode === "sign_in") next = { mode: "egg", excludedPaths: input.data.excludedPaths };
  else if (input.data.mode === "password") next = { mode: "password", passwordHash: passwordHash!, excludedPaths: input.data.excludedPaths };
  else {
    if (!previous?.success || previous.data.mode !== "basic-auth") throw new HttpError(400, "Basic authentication requires server-side username credentials.", "validation");
    next = { ...previous.data, excludedPaths: input.data.excludedPaths };
  }
  const serialized = JSON.stringify(next);
  await db.run(sql`INSERT INTO project_access_protection(project_id, config_json, updated_at)
    VALUES (${project.id}, ${serialized}, ${new Date().toISOString()})
    ON CONFLICT(project_id) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at`);
  return getAccessSettings(userId, projectId);
}

const passwordInput = z.string().min(12, "Use at least 12 characters.").max(256, "Password is too long.");

function derivePassword(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, KEY_BYTES, { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(Buffer.from(key));
    });
  });
}

/** Salted scrypt password verifier; the plaintext password is never retained. */
export async function hashAccessPassword(password: string): Promise<string> {
  const value = passwordInput.parse(password);
  const salt = randomBytes(16);
  const key = await derivePassword(value, salt);
  return `scrypt$32768$8$1$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyAccessPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt" || parts[1] !== "32768" || parts[2] !== "8" || parts[3] !== "1") return false;
  const salt = Buffer.from(parts[4], "base64url");
  const expected = Buffer.from(parts[5], "base64url");
  if (salt.length !== 16 || expected.length !== KEY_BYTES || Buffer.byteLength(password, "utf8") > 256) return false;
  const actual = await derivePassword(password, salt);
  return timingSafeEqual(actual, expected);
}

/** Exact paths and `/**` suffix rules; query strings are intentionally ignored. */
export function isExcludedAccessPath(pathname: string, excludedPaths: readonly string[]): boolean {
  const path = pathname.split(/[?#]/, 1)[0] || "/";
  return excludedPaths.some((rule) => {
    if (rule.endsWith("/**")) {
      const prefix = rule.slice(0, -3).replace(/\/$/, "");
      return path === prefix || path.startsWith(`${prefix}/`);
    }
    return path === rule;
  });
}

type SessionPayload = { projectId: string; userId: string; expiresAt: number };
function signingKey(): Buffer {
  return createHmac("sha256", config().APP_SECRET).update("egg-project-access-session-v1").digest();
}
function signature(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

export function issueAccessSession(projectId: string, userId: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ projectId, userId, expiresAt: Math.floor(now / 1000) + ACCESS_SESSION_TTL_SECONDS } satisfies SessionPayload)).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function verifyAccessSession(token: string | null | undefined, projectId: string, now = Date.now()): SessionPayload | null {
  if (!token || token.length > 2048) return null;
  const [payload, supplied, extra] = token.split(".");
  if (!payload || !supplied || extra !== undefined) return null;
  const expected = Buffer.from(signature(payload));
  const actual = Buffer.from(supplied);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<SessionPayload>;
    if (typeof decoded.projectId !== "string" || decoded.projectId !== projectId || typeof decoded.userId !== "string" || !decoded.userId || typeof decoded.expiresAt !== "number" || decoded.expiresAt <= Math.floor(now / 1000)) return null;
    return decoded as SessionPayload;
  } catch {
    return null;
  }
}
