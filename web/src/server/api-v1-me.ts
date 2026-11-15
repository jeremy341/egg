import { and, count, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { SCOPES, type Principal } from "@/server/api-tokens";
import { endpoint, type Endpoint } from "@/server/api-v1-kit";
import { getDb, schema } from "@/server/db";
import { HttpError } from "@/server/http";

/**
 * `GET /me`: who a token belongs to and what it may do. It needs no scope, so it
 * is the first call a script or an agent makes to check its token works. It
 * returns the owner's display name only (never the email), the token's name,
 * scopes and expiry, and how many servers and projects the owner has. No ids and
 * nothing secret.
 */

export async function apiGetMe(p: Principal) {
  const db = await getDb();
  const user = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, p.userId)).get();
  const token = await db
    .select({ name: schema.apiTokens.name, expiresAt: schema.apiTokens.expiresAt })
    .from(schema.apiTokens)
    .where(and(eq(schema.apiTokens.id, p.tokenId), eq(schema.apiTokens.userId, p.userId)))
    .get();
  // The token was valid a moment ago; if either row is gone it was just revoked or the account deleted.
  if (!user || !token) throw new HttpError(401, "That access token is not valid.", "unauthorized", { "WWW-Authenticate": "Bearer" });

  const [servers] = await db.select({ n: count() }).from(schema.servers).where(and(eq(schema.servers.userId, p.userId), ne(schema.servers.status, "disconnected")));
  const [projects] = await db.select({ n: count() }).from(schema.projects).where(eq(schema.projects.userId, p.userId));
  return {
    user: { name: user.name },
    token: { name: token.name, scopes: p.scopes, expiresAt: token.expiresAt.toISOString() },
    counts: { servers: servers?.n ?? 0, projects: projects?.n ?? 0 },
  };
}

export const ME_ENDPOINTS: Endpoint[] = [
  endpoint({
    id: "get_me",
    method: "GET",
    path: "/me",
    scope: null,
    bucket: "read",
    tag: "Account",
    summary: "Who this token is",
    description:
      "Return the token owner's display name, the token's name, its scopes and when it expires, and how many servers and projects the owner has. Needs no scope: any valid token can call it. Call it first to check the token works and to see which other tools it may use. It never returns an email address.",
    response: z.object({
      user: z.object({ name: z.string() }),
      token: z.object({
        name: z.string(),
        scopes: z.array(z.enum(SCOPES)).describe("What this token may do. Other calls need one of these."),
        expiresAt: z.string().describe("ISO 8601 time the token stops working."),
      }),
      counts: z.object({ servers: z.number().int(), projects: z.number().int() }),
    }),
    run: (p) => apiGetMe(p),
  }),
];
