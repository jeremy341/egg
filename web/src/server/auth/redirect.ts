import { z } from "zod";

/**
 * A same-site path to send someone to after sign-in, or `fallback`. A bare
 * "starts with / and not //" check is not enough: browsers read a backslash as a
 * slash and drop tabs and line breaks, so "/\evil.example" and "/<tab>/evil.example"
 * both leave the site. Reject those, then confirm the path still resolves to our own origin.
 */
export function safeNextPath(raw: unknown, fallback = "/account"): string {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return fallback;
  try {
    const base = "https://app.invalid";
    if (new URL(raw, base).origin !== base) return fallback;
  } catch {
    return fallback;
  }
  return raw;
}

const oauthCookie = z.object({
  s: z.string().min(1),
  v: z.string().min(1),
  p: z.literal("reauth").optional(),
  n: z.string().optional(),
  /** Hash of the session token that started a reauth; required for reauth by the callback. */
  r: z.string().optional(),
});
export type OauthCookie = z.infer<typeof oauthCookie>;

/** The short-lived sign-in cookie, or null when it is missing a field or has the wrong shape. */
export function parseOauthCookie(raw: string): OauthCookie | null {
  try {
    const parsed = oauthCookie.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
