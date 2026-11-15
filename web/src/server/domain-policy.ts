/**
 * Reserved names copied from hackclub/nest (MIT, https://github.com/hackclub/nest), with the Egg additions below.
 *
 * Egg does not route traffic: Nest does, on its own dashboard. What Egg controls is which
 * domains it will record and show as active. These rules follow Nest's own checks
 * (mocinno/backend: addDomain, isWhitelisted, checkDNSVerification, isPublicDomain) and add
 * a reserved-name block so nobody records nest.hackclub.app or admin.hackclub.app as theirs.
 */

import { isIP } from "node:net";

/** From hackclub/nest reservedUsernames.ts, kept in the same order. */
const NEST_RESERVED = [
  "umami",
  "erugo",
  "abuse",
  "account",
  "accounts",
  "sso",
  "authenticate",
  "admin",
  "administrator",
  "administrators",
  "api",
  "app",
  "apps",
  "auth",
  "authentication",
  "autoconfig",
  "autodiscover",
  "bastion",
  "billing",
  "blog",
  "cdn",
  "cgi",
  "contact",
  "copyright",
  "cpanel",
  "daemon",
  "dashboard",
  "demo",
  "dmca",
  "dns",
  "docs",
  "documentation",
  "email",
  "faq",
  "forgejo",
  "ftp",
  "git",
  "guest",
  "guide",
  "guides",
  "help",
  "home",
  "host",
  "hosting",
  "hostmaster",
  "hostname",
  "imap",
  "info",
  "ldap",
  "legal",
  "localhost",
  "login",
  "logout",
  "mail",
  "mailer",
  "mailman",
  "master",
  "mx",
  "mysql",
  "nobody",
  "noc",
  "ns1",
  "ns2",
  "ns3",
  "ns4",
  "ntp",
  "oauth",
  "operator",
  "panel",
  "password",
  "pop",
  "pop3",
  "postfix",
  "postgres",
  "postmaster",
  "privacy",
  "profile",
  "proxy",
  "register",
  "relay",
  "root",
  "router",
  "sales",
  "search",
  "secure",
  "security",
  "server",
  "settings",
  "sftp",
  "signin",
  "signup",
  "smtp",
  "ssh",
  "ssl",
  "ssladmin",
  "ssladministrator",
  "sslwebmaster",
  "staff",
  "status",
  "subdomain",
  "support",
  "sysadmin",
  "system",
  "terms",
  "termsofservice",
  "test",
  "tos",
  "user",
  "username",
  "usernames",
  "users",
  "vpn",
  "web",
  "webmail",
  "webmaster",
  "www",
  "www1",
  "www2",
  "www3",
] as const;

/** Names Egg reserves on top of Nest's list. */
const EGG_RESERVED = ["egg", "nest", "hackclub", "hack-club", "nest-deploy", "egg-deploy", "loadout"] as const;

export const RESERVED_NAMES: ReadonlySet<string> = new Set<string>([...NEST_RESERVED, ...EGG_RESERVED]);

/** Suffixes whose names belong to Hack Club (or to the local machine), not to a user. */
const PROTECTED_SUFFIXES = ["hackclub.app", "hackclub.com", "hackclub.dev", "localhost"] as const;
const NEST_SUFFIX = "hackclub.app";

/** From hackclub/nest cert.ts isPublicDomain, so Egg refuses what Nest cannot issue a certificate for. */
const NON_PUBLIC_TLDS = /(\.localhost|\.local|\.internal|\.home\.arpa)$/i;

export function isPublicDomain(domain: string): boolean {
  if (!domain || domain === "localhost") return false;
  if (NON_PUBLIC_TLDS.test(domain)) return false;
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(domain) || isIP(domain)) return false;
  if (/^[0-9a-fA-F:]+$/.test(domain)) return false;
  return true;
}

export type PolicyResult =
  | { allowed: true }
  | { allowed: false; code: "reserved" | "nest-name" | "not-public"; message: string };

export const MESSAGES = {
  reserved: "That name is reserved. Choose another domain.",
  notPublic: "Use a public domain name such as app.example.com. IP addresses, localhost and internal names cannot be used.",
  nestName: (username: string) =>
    `Only your Nest name, ${username}.hackclub.app, can be used under hackclub.app.`,
} as const;

function clean(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.$/, "");
}

/** True for `<username>.hackclub.app` and anything under it: the names Nest hands out with no DNS check. */
export function isNestName(domain: string, nestUsername: string): boolean {
  const d = clean(domain);
  const own = `${nestUsername.toLowerCase()}.${NEST_SUFFIX}`;
  return d === own || d.endsWith(`.${own}`);
}

/** True when `domain` is a strict subdomain of `parent`. */
export function isSubdomainOf(domain: string, parent: string): boolean {
  return clean(domain).endsWith(`.${clean(parent)}`);
}

/**
 * The longest verified domain in `owned` that `domain` sits under, or null. A subdomain of a
 * domain the user already verified on the same server needs no new DNS check (Nest does the same).
 */
export function ownedParentOf<T extends { domain: string; status: string }>(
  domain: string,
  owned: readonly T[]
): T | null {
  let best: T | null = null;
  for (const o of owned) {
    if (o.status !== "valid" || !isSubdomainOf(domain, o.domain)) continue;
    if (!best || o.domain.length > best.domain.length) best = o;
  }
  return best;
}

/**
 * Whether Egg will record this domain for this Nest account. Pure: no DNS, no database.
 * Rules, in order:
 *  1. A reserved name is refused under hackclub.app, hackclub.com, hackclub.dev and localhost,
 *     and so is a bare reserved word. Under hackclub.app the label that is checked is the one
 *     right under the suffix (the account name), so `api.sam-r.hackclub.app` stays open to sam-r.
 *  2. Under hackclub.app only the account's own Nest name, and names under it, are allowed.
 *  3. Anything else is a custom domain and must be a public domain name.
 */
export function checkDomainPolicy(domain: string, nestUsername: string): PolicyResult {
  const d = clean(domain);
  const deny = (code: "reserved" | "nest-name" | "not-public", message: string): PolicyResult => ({
    allowed: false,
    code,
    message,
  });

  if (!d.includes(".") && RESERVED_NAMES.has(d)) return deny("reserved", MESSAGES.reserved);

  for (const suffix of PROTECTED_SUFFIXES) {
    if (d === suffix) return deny("reserved", MESSAGES.reserved);
    if (!d.endsWith(`.${suffix}`)) continue;
    const labels = d.slice(0, -(suffix.length + 1)).split(".");
    const checked = suffix === NEST_SUFFIX ? [labels[labels.length - 1]] : labels;
    if (checked.some((l) => RESERVED_NAMES.has(l))) return deny("reserved", MESSAGES.reserved);
  }

  if (d.endsWith(`.${NEST_SUFFIX}`)) {
    return isNestName(d, nestUsername) ? { allowed: true } : deny("nest-name", MESSAGES.nestName(nestUsername));
  }

  if (!isPublicDomain(d)) return deny("not-public", MESSAGES.notPublic);
  return { allowed: true };
}
