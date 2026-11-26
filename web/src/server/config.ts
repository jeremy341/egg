import { isIP } from "node:net";
import { z } from "zod";

/**
 * Environment configuration. Read lazily so `next build` works without
 * secrets; the first request (or the worker start) validates everything.
 * Normalize case and whitespace here so every boolean uses one parser: the
 * rate-limit path reads TRUST_PROXY straight from the environment with the
 * same trimming, and a value like "TRUE" must not be accepted there and
 * rejected here (which used to 500 every request on startup).
 */
const bool = z
  .string()
  .trim()
  .toLowerCase()
  .refine((v) => v === "0" || v === "1" || v === "true" || v === "false", {
    message: "Expected 0, 1, true or false",
  })
  .default("0")
  .transform((v) => v === "1" || v === "true");

/**
 * Whether to believe the proxy headers (X-Forwarded-For, X-Real-IP) for client addresses.
 * Off unless TRUST_PROXY is 1 or true. Turn it on only when every request reaches Egg
 * through a reverse proxy you run, which sets those headers itself. Read straight from the
 * environment so a rate limit never depends on the rest of the configuration being valid.
 */
export function trustProxyEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const v = env.TRUST_PROXY?.trim().toLowerCase();
  return v === "1" || v === "true";
}

/** True for localhost, any real 127.x.x.x address and ::1. Anything else is a remote address. */
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h === "::1") return true;
  if (isIP(h) !== 4 || !h.startsWith("127.")) return false;
  return h.split(".").every((part) => {
    const n = Number(part);
    return part.length > 0 && n >= 0 && n <= 255 && String(n) === part;
  });
}

const schema = z
  .object({
    APP_URL: z.string().url().default("http://localhost:3000"),
    /** Master secret for encrypting SSH keys and env vars. 32+ characters. */
    APP_SECRET: z.string().min(32, "APP_SECRET must be at least 32 characters"),
    DATABASE_URL: z.string().default("file:./data/egg.db"),

    /**
     * Optional email delivery: Egg POSTs {to, subject, text} as JSON here. Unset
     * means no email; invitations then show a one-time link instead.
     */
    EMAIL_WEBHOOK_URL: z.string().url().optional(),

    HACKCLUB_CLIENT_ID: z.string().optional(),
    HACKCLUB_CLIENT_SECRET: z.string().optional(),
    /** Local development only: sign in as a fake user without Hack Club Auth. */
    DEV_LOGIN: bool,
    /**
     * Self-hosting on your own computer: sign in without any external account.
     * Off unless set. Refused when APP_URL is not a local address, because anyone
     * who can reach the site could then sign in as the owner.
     */
    LOCAL_MODE: bool,
    /** Private first-sign-in and password-reset key; created by setup, never the regular password. */
    LOCAL_MODE_SECRET: z.string().min(32, "LOCAL_MODE_SECRET must be at least 32 characters").optional(),
    /** Explicit override that lets LOCAL_MODE run on a non-local APP_URL. Use only behind your own access control. */
    LOCAL_MODE_ALLOW_REMOTE: bool,
    /** Believe X-Forwarded-For and X-Real-IP for client addresses. See trustProxyEnabled. */
    TRUST_PROXY: bool,

    GITHUB_APP_ID: z.string().optional(),
    GITHUB_APP_SLUG: z.string().optional(),
    GITHUB_APP_CLIENT_ID: z.string().optional(),
    GITHUB_APP_CLIENT_SECRET: z.string().optional(),
    /** PEM text. "\n" escape sequences are accepted. */
    GITHUB_APP_PRIVATE_KEY: z.string().optional(),
    GITHUB_WEBHOOK_SECRET: z.string().optional(),

    /** Where a deployment's source is cloned and packed before it is uploaded. Nothing is built here. */
    DEPLOY_WORK_DIR: z.string().default("./data/work"),
    /** Where systemd units are written on the container. Only change for testing. */
    UNIT_DIR: z.string().default("/etc/systemd/system"),
    /** Where Nest's SSH bastion lives. */
    NEST_HOST: z.string().default("hackclub.app"),
    NEST_PORT: z.coerce.number().int().positive().default(22),
  })
  .superRefine((c, ctx) => {
    if (c.LOCAL_MODE && !c.LOCAL_MODE_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["LOCAL_MODE_SECRET"],
        message:
          "LOCAL_MODE requires a private LOCAL_MODE_SECRET. Existing installs must add a random secret of at least 32 characters to .env.local; the setup command will not overwrite that file.",
      });
    }
    if (!c.LOCAL_MODE || c.LOCAL_MODE_ALLOW_REMOTE) return;
    let hostname: string;
    try {
      hostname = new URL(c.APP_URL).hostname;
    } catch {
      // The .url() check on APP_URL already reports the invalid value; don't
      // throw a raw TypeError out of the refinement and hide that message.
      return;
    }
    if (isLoopbackHost(hostname)) return;
    ctx.addIssue({
      code: "custom",
      path: ["LOCAL_MODE"],
      message:
        "LOCAL_MODE signs anyone in as the owner, so APP_URL must be localhost or 127.0.0.1. " +
        "Set APP_URL to a local address, or set LOCAL_MODE_ALLOW_REMOTE=1 if you control who can reach the site.",
    });
  });

export type Config = z.infer<typeof schema>;

let cached: Config | undefined;

export function config(): Config {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  ${i.path.join(".")}: ${i.message}`
    );
    throw new Error(
      `Invalid environment configuration:\n${lines.join("\n")}\n` +
        "Run `pnpm run setup` to create .env.local, or see .env.example."
    );
  }
  cached = parsed.data;
  if (cached.GITHUB_APP_PRIVATE_KEY) {
    cached.GITHUB_APP_PRIVATE_KEY = cached.GITHUB_APP_PRIVATE_KEY.replace(
      /\\n/g,
      "\n"
    );
  }
  return cached;
}

/** For tests: drop the cached config so a changed process.env is re-read. */
export function resetConfigForTests() {
  cached = undefined;
}

export function localModeEnabled() {
  return config().LOCAL_MODE;
}

export function hackClubConfigured() {
  const c = config();
  return Boolean(c.HACKCLUB_CLIENT_ID && c.HACKCLUB_CLIENT_SECRET);
}

export function githubConfigured() {
  const c = config();
  return Boolean(
    c.GITHUB_APP_ID &&
      c.GITHUB_APP_PRIVATE_KEY &&
      c.GITHUB_APP_CLIENT_ID &&
      c.GITHUB_APP_CLIENT_SECRET &&
      c.GITHUB_WEBHOOK_SECRET
  );
}
