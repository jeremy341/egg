import { promises as dns } from "node:dns";
import { isIP } from "node:net";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { runAppCheck, type AppCheckReport, type Probe } from "@/server/app-check";
import { newId } from "@/server/crypto";
import { getDb, schema, type Db } from "@/server/db";
import { HttpError, notFound } from "@/server/http";
import { checkDomainPolicy, isNestName, ownedParentOf } from "@/server/domain-policy";
import { getServerForUser } from "@/server/servers";

/**
 * Nest maps a domain to a container port on its own dashboard, and that step
 * has no API. So this module records what the user intends, tells them exactly
 * what to enter in the Nest dashboard, and checks DNS to see if it is done.
 */

const HOSTNAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function normalizeDomain(input: string): string {
  const d = input.trim().toLowerCase().replace(/\.$/, "");
  if (isIP(d) || !HOSTNAME.test(d)) {
    throw new HttpError(
      400,
      "Enter a domain name such as app.example.com (not an IP address or a URL).",
      "validation"
    );
  }
  return d;
}

export const domainInput = z.object({
  serverId: z.string().min(1),
  domain: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535),
  projectId: z.string().nullable().optional(),
});

/** The name a custom domain should point at (CNAME). */
export function cnameTarget(nestUsername: string) {
  return `${nestUsername}.hackclub.app`;
}

/** The TXT value Nest accepts as proof that the domain belongs to this account. */
export function txtValue(nestUsername: string) {
  return `domain-verification=${nestUsername}`;
}

export type VerifiedBy = "dns" | "nest" | "parent";

/**
 * What to do, in order: the DNS record, then the Nest dashboard, then Check. A Nest name needs
 * no record, and neither does a subdomain of a domain that is already verified on this server.
 */
export function dashboardInstructions(
  domain: string,
  port: number,
  nestUsername: string,
  verifiedBy: VerifiedBy = isNestName(domain, nestUsername) ? "nest" : "dns"
) {
  const nestStep = `Open the Domains page in the Nest dashboard, add ${domain}, and set its target port to ${port}.`;
  if (verifiedBy !== "dns") {
    return {
      steps: [nestStep, `Come back here and press Check.`],
      cname: null,
      txt: null,
    };
  }
  return {
    steps: [
      `At your DNS provider, add either a CNAME record for ${domain} pointing to ${cnameTarget(nestUsername)}, or a TXT record on ${domain} with the value ${txtValue(nestUsername)}. Nest checks the same record when you add the domain, so add it first.`,
      nestStep,
      `Come back here and press Check. ${domain} shows as active once the record is found.`,
    ],
    cname: { name: domain, value: cnameTarget(nestUsername) },
    txt: { name: domain, value: txtValue(nestUsername) },
  };
}

function isUniqueViolation(err: unknown): boolean {
  const text = `${(err as Error)?.message ?? ""} ${(err as { cause?: Error })?.cause?.message ?? ""}`;
  return /UNIQUE|unique constraint|duplicate key/i.test(text);
}

export async function addDomain(userId: string, raw: unknown) {
  const input = domainInput.parse(raw);
  const server = await getServerForUser(userId, input.serverId);
  const domain = normalizeDomain(input.domain);
  const policy = checkDomainPolicy(domain, server.nestUsername);
  if (!policy.allowed) throw new HttpError(400, policy.message, "validation");
  const db = await getDb();

  if (input.projectId) {
    const project = await db
      .select()
      .from(schema.projects)
      .where(and(eq(schema.projects.id, input.projectId), eq(schema.projects.userId, userId)))
      .get();
    if (!project || project.serverId !== server.id) throw notFound("Project not found");
  }
  // One answer whether the domain is yours already or on someone else's server: it is taken.
  if (await db.select().from(schema.domains).where(eq(schema.domains.domain, domain)).get()) {
    throw new HttpError(409, `${domain} is already added.`, "conflict");
  }

  // Nest names need no check, and neither does a subdomain of a domain already verified on this server.
  const mine = await db
    .select()
    .from(schema.domains)
    .where(and(eq(schema.domains.userId, userId), eq(schema.domains.serverId, server.id)));
  const verifiedBy: VerifiedBy = isNestName(domain, server.nestUsername)
    ? "nest"
    : ownedParentOf(domain, mine)
      ? "parent"
      : "dns";
  // A Nest name is accepted without DNS, so it must first be proven: a connection to this server shows the
  // owner controls that Nest account. Without this, anyone could claim someone else's name before its owner does.
  if (verifiedBy === "nest" && (server.status !== "connected" || !server.hostKeyFingerprint)) {
    throw new HttpError(400, "Connect this server before adding its Nest name.", "validation");
  }

  const id = newId();
  try {
    await db.insert(schema.domains).values({
      id,
      userId,
      serverId: server.id,
      projectId: input.projectId ?? null,
      domain,
      port: input.port,
      status: verifiedBy === "dns" ? "pending" : "valid",
      createdAt: new Date(),
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, `${domain} is already added.`, "conflict");
    throw err;
  }
  await audit(userId, "domain.add", input.projectId ?? null, { domain });
  return {
    domain: (await db.select().from(schema.domains).where(eq(schema.domains.id, id)).get())!,
    instructions: dashboardInstructions(domain, input.port, server.nestUsername, verifiedBy),
  };
}

export async function listDomains(userId: string) {
  const db = await getDb();
  return db
    .select()
    .from(schema.domains)
    .where(eq(schema.domains.userId, userId))
    .orderBy(schema.domains.createdAt);
}

export async function removeDomain(userId: string, domainId: string) {
  const db = await getDb();
  const row = await db
    .select()
    .from(schema.domains)
    .where(and(eq(schema.domains.id, domainId), eq(schema.domains.userId, userId)))
    .get();
  if (!row) throw notFound("Domain not found");
  await db.delete(schema.domains).where(eq(schema.domains.id, row.id));
  await audit(userId, "domain.remove", null, { domain: row.domain });
}

export const domainPatch = z
  .object({
    projectId: z.string().nullable().optional(),
    port: z.number().int().min(1).max(65535).optional(),
  })
  .refine((v) => v.projectId !== undefined || v.port !== undefined, "Nothing to change");

/**
 * Point a recorded domain at another project or port. Nest holds the real
 * mapping, so the caller is told when the Nest dashboard needs the same change.
 */
export async function updateDomain(userId: string, domainId: string, raw: unknown) {
  const input = domainPatch.parse(raw);
  const db = await getDb();
  const row = await db
    .select()
    .from(schema.domains)
    .where(and(eq(schema.domains.id, domainId), eq(schema.domains.userId, userId)))
    .get();
  if (!row) throw notFound("Domain not found");

  let projectId = row.projectId;
  let port = input.port ?? row.port;
  if (input.projectId !== undefined) {
    if (input.projectId === null) {
      projectId = null;
    } else {
      const project = await db
        .select()
        .from(schema.projects)
        .where(and(eq(schema.projects.id, input.projectId), eq(schema.projects.userId, userId)))
        .get();
      if (!project || project.serverId !== row.serverId) throw notFound("Project not found");
      projectId = project.id;
      // Moving to a project without naming a port means "use that project's port".
      if (input.port === undefined) port = project.port;
    }
  }

  const portChanged = port !== row.port;
  await db
    .update(schema.domains)
    .set({ projectId, port, ...(portChanged ? { status: "pending" as const, lastCheckedAt: null } : {}) })
    .where(eq(schema.domains.id, row.id));
  await audit(userId, "domain.update", projectId, { domain: row.domain, port });

  const server = await getServerForUser(userId, row.serverId);
  return {
    domain: (await db.select().from(schema.domains).where(eq(schema.domains.id, row.id)).get())!,
    needsNestChange: portChanged,
    instructions: portChanged ? dashboardInstructions(row.domain, port, server.nestUsername) : null,
  };
}

/**
 * A project changed its port: its domains follow it and go back to pending, because the
 * Nest dashboard still maps them to the old port until the owner changes it there.
 * Takes the caller's transaction so the project and its domains change together.
 */
export async function moveDomainsToPort(db: Pick<Db, "update">, projectId: string, port: number) {
  await db
    .update(schema.domains)
    .set({ port, status: "pending", lastCheckedAt: null })
    .where(eq(schema.domains.projectId, projectId));
}

export type Resolver = {
  resolveCname: (name: string) => Promise<string[]>;
  resolve4: (name: string) => Promise<string[]>;
  resolveTxt: (name: string) => Promise<string[][]>;
};

/** ok: the record is there. missing: it is not. unknown: the lookup itself failed, so say nothing about the record. */
export type DnsState = "ok" | "missing" | "unknown";
export type DnsCheck = { state: DnsState; reason: string | null };

const NO_RECORD = new Set(["ENODATA", "ENOTFOUND", "ENODOMAIN"]);
const LOOKUP_FAILED = "DNS could not be checked right now. Try again in a minute.";
const NOT_IN_NEST = "The name does not resolve yet. Add it in the Nest dashboard first.";

/**
 * The check Nest runs when a domain is added (checkDNSVerification): a TXT record
 * `domain-verification=<username>` on the name, or a CNAME to `<username>.hackclub.app`.
 * A Nest name has no record we control, so it only has to resolve.
 */
export async function checkDns(domain: string, nestUsername: string, resolver: Resolver = dns): Promise<DnsCheck> {
  const target = cnameTarget(nestUsername);

  if (isNestName(domain, nestUsername)) {
    try {
      return (await resolver.resolve4(domain)).length > 0
        ? { state: "ok", reason: null }
        : { state: "missing", reason: NOT_IN_NEST };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "";
      return NO_RECORD.has(code)
        ? { state: "missing", reason: NOT_IN_NEST }
        : { state: "unknown", reason: LOOKUP_FAILED };
    }
  }

  try {
    const records = await resolver.resolveTxt(domain);
    if (records.some((r) => r.join("") === txtValue(nestUsername))) return { state: "ok", reason: null };
  } catch {
    // Nest ignores a TXT lookup that fails and goes on to the CNAME, so do the same.
  }

  try {
    const cnames = (await resolver.resolveCname(domain)).map((c) => c.replace(/\.$/, "").toLowerCase());
    if (cnames.includes(target.toLowerCase())) return { state: "ok", reason: null };
    return {
      state: "missing",
      reason: cnames.some((c) => c.endsWith(".hackclub.app"))
        ? `The CNAME points to ${cnames[0]}, but it should point to ${target}.`
        : `The CNAME points to ${cnames[0]}. It should point to ${target}.`,
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? "";
    return NO_RECORD.has(code)
      ? {
          state: "missing",
          reason: `No CNAME found yet. Create one pointing to ${target}, or add a TXT record with the value ${txtValue(nestUsername)}. DNS changes can take a few minutes.`,
        }
      : { state: "unknown", reason: LOOKUP_FAILED };
  }
}

const CACHE_MS = 60_000;
const READ_TIMEOUT_MS = 2_500;
const dnsCache = new Map<string, { at: number; state: DnsState }>();
const cacheKey = (domain: string, nestUsername: string) => `${domain}|${nestUsername}`;
function remember(domain: string, nestUsername: string, state: DnsState) {
  if (state === "unknown") return;
  if (dnsCache.size > 500) dnsCache.clear();
  dnsCache.set(cacheKey(domain, nestUsername), { at: Date.now(), state });
}
/** Test hook: forget what the last checks found. */
export function clearDnsCache() {
  dnsCache.clear();
}

/**
 * Check DNS and the stored status together. A verified domain whose record is gone
 * becomes "invalid" (never deleted); a domain still waiting stays "pending"; a failed
 * lookup changes nothing.
 */
export async function verifyDomain(
  userId: string,
  domainId: string,
  resolver: Resolver = dns
): Promise<{ status: "valid" | "invalid"; reason: string | null }> {
  const db = await getDb();
  const row = await db
    .select()
    .from(schema.domains)
    .where(and(eq(schema.domains.id, domainId), eq(schema.domains.userId, userId)))
    .get();
  if (!row) throw notFound("Domain not found");
  const server = await getServerForUser(userId, row.serverId);

  const nest = isNestName(row.domain, server.nestUsername);
  const siblings = await db
    .select()
    .from(schema.domains)
    .where(and(eq(schema.domains.userId, userId), eq(schema.domains.serverId, row.serverId)));
  const parent = nest
    ? null
    : ownedParentOf(
        row.domain,
        siblings.filter((s) => s.id !== row.id)
      );

  const result: DnsCheck = parent
    ? { state: "ok", reason: null }
    : await checkDns(row.domain, server.nestUsername, resolver);
  remember(row.domain, server.nestUsername, result.state);

  if (result.state !== "unknown") {
    // Only a record verified through DNS can go bad. A Nest name or a subdomain of a
    // verified domain keeps its status when the lookup fails; the reason is still shown.
    const lost = result.state === "missing" && row.status === "valid" && !nest;
    const status = result.state === "ok" ? "valid" : lost ? "invalid" : row.status;
    await db.update(schema.domains).set({ status, lastCheckedAt: new Date() }).where(eq(schema.domains.id, row.id));
  }
  return { status: result.state === "ok" ? "valid" : "invalid", reason: result.reason };
}

type ActiveRow = { id: string; domain: string; status: string; nestUsername: string };

/**
 * Domains shown as active whose DNS record no longer matches. The Domains page calls this on
 * every read, so answers are cached for 60 seconds per domain and a slow lookup gives up after
 * a couple of seconds and says nothing. A subdomain that rides on a verified parent follows the
 * parent. Returns the ids to warn about. Nothing is changed or removed.
 */
export async function activeDomainWarnings(rows: ActiveRow[], resolver: Resolver = dns): Promise<Set<string>> {
  const active = rows.filter((r) => r.status === "valid" && !isNestName(r.domain, r.nestUsername));
  const parentOf = (r: ActiveRow) =>
    ownedParentOf(
      r.domain,
      active.filter((a) => a.id !== r.id && a.nestUsername === r.nestUsername)
    );
  const rootOf = (r: ActiveRow): ActiveRow => {
    let cur = r;
    for (let i = 0; i < 10; i++) {
      const p = parentOf(cur);
      if (!p) return cur;
      cur = p;
    }
    return cur;
  };

  const roots = new Map<string, ActiveRow>();
  for (const r of active) {
    const root = rootOf(r);
    roots.set(root.id, root);
  }

  const bad = new Set<string>();
  await Promise.all(
    [...roots.values()].map(async (r) => {
      const hit = dnsCache.get(cacheKey(r.domain, r.nestUsername));
      let state: DnsState;
      if (hit && Date.now() - hit.at < CACHE_MS) {
        state = hit.state;
      } else {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<DnsCheck>((resolve) => {
          timer = setTimeout(() => resolve({ state: "unknown", reason: null }), READ_TIMEOUT_MS);
        });
        try {
          state = (await Promise.race([checkDns(r.domain, r.nestUsername, resolver), timeout])).state;
        } finally {
          clearTimeout(timer);
        }
        remember(r.domain, r.nestUsername, state);
      }
      if (state === "missing") bad.add(r.id);
    })
  );

  const warned = new Set<string>();
  for (const r of active) if (bad.has(rootOf(r).id)) warned.add(r.id);
  return warned;
}

export type DomainAppCheck =
  | ({ skipped: false } & AppCheckReport)
  | { skipped: true; reason: string; certificateVerified: false; certificateLabel: string };

/**
 * Ask the app itself: request a domain the user registered over HTTPS and
 * report the status code. Only runs for a recorded domain owned by the user,
 * only for names that resolve to public addresses (see net-guard), and only
 * once DNS already points at Nest.
 */
export async function checkDomainApp(
  userId: string,
  domainId: string,
  dnsStatus: "valid" | "invalid",
  probe?: Probe
): Promise<DomainAppCheck> {
  const db = await getDb();
  const row = await db
    .select()
    .from(schema.domains)
    .where(and(eq(schema.domains.id, domainId), eq(schema.domains.userId, userId)))
    .get();
  if (!row) throw notFound("Domain not found");
  if (dnsStatus !== "valid") {
    return {
      skipped: true,
      reason: "The app check runs once DNS points at Nest.",
      certificateVerified: false,
      certificateLabel: "Certificate not verified yet",
    };
  }
  let healthPath: string | null = null;
  if (row.projectId) {
    const project = await db
      .select({ healthPath: schema.projects.healthPath })
      .from(schema.projects)
      .where(and(eq(schema.projects.id, row.projectId), eq(schema.projects.userId, userId)))
      .get();
    healthPath = project?.healthPath ?? null;
  }
  return { skipped: false, ...(await runAppCheck(row.domain, healthPath, probe)) };
}
