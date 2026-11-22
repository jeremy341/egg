import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { upsertUser } from "@/server/auth/session";
import { eq } from "drizzle-orm";
import {
  activeDomainWarnings,
  addDomain,
  clearDnsCache,
  cnameTarget,
  dashboardInstructions,
  normalizeDomain,
  PENDING_CLAIM_MAX_AGE_MS,
  removeDomain,
  txtValue,
  updateDomain,
  verifyDomain,
  type Resolver,
} from "@/server/domains";
import { getDb, schema } from "@/server/db";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let userId: string;
let serverId: string;

beforeAll(async () => {
  ctx = await useFreshDb();
  userId = (await upsertUser({ id: "u1", name: "Sam", email: null, slackId: null })).id;
  serverId = (await createServer(userId, "sam-r")).id;
  // A Nest name is only accepted once the server has been connected, so the fixture is connected here.
  await ctx.db
    .update(schema.servers)
    .set({ status: "connected", hostKeyFingerprint: "SHA256:test-fixture" })
    .where(eq(schema.servers.id, serverId));
});
afterAll(async () => {
  await ctx.cleanup();
});

const dnsError = (code: string) => Object.assign(new Error(code), { code });

describe("domain validation", () => {
  it("normalises valid names", () => {
    expect(normalizeDomain(" App.Example.COM. ")).toBe("app.example.com");
    expect(normalizeDomain("poorup.sam-r.hackclub.app")).toBe("poorup.sam-r.hackclub.app");
  });
  it("rejects URLs, IPs, paths and junk", () => {
    for (const bad of ["https://a.com", "1.2.3.4", "a.com/x", "localhost", "-a.com", "a..com", "a b.com", ""]) {
      expect(() => normalizeDomain(bad)).toThrow();
    }
  });
});

describe("instructions", () => {
  it("tells custom domains to add a CNAME or TXT record, and Nest names to skip it", () => {
    const custom = dashboardInstructions("app.example.com", 3000, "sam-r");
    expect(custom.cname).toEqual({ name: "app.example.com", value: "sam-r.hackclub.app" });
    expect(custom.txt).toEqual({ name: "app.example.com", value: "domain-verification=sam-r" });
    expect(custom.steps.join(" ")).toContain("target port to 3000");
    const nest = dashboardInstructions("x.sam-r.hackclub.app", 3000, "sam-r");
    expect(nest.cname).toBeNull();
    expect(nest.txt).toBeNull();
  });
  it("orders the steps: DNS record, Nest dashboard, Check", () => {
    const [record, dashboard, check] = dashboardInstructions("app.example.com", 3000, "sam-r").steps;
    expect(record).toMatch(/CNAME record .* sam-r\.hackclub\.app, or a TXT record .* domain-verification=sam-r/);
    expect(dashboard).toContain("Nest dashboard");
    expect(check).toContain("press Check");
  });
  it("needs no record for a subdomain of a verified domain", () => {
    const sub = dashboardInstructions("api.example.com", 3000, "sam-r", "parent");
    expect(sub.cname).toBeNull();
    expect(sub.steps.join(" ")).toContain("Nest dashboard");
  });
});

describe("domain records", () => {
  it("adds, rejects duplicates, and removes", async () => {
    const { domain, instructions } = await addDomain(userId, { serverId, domain: "App.Example.com", port: 3000 });
    expect(domain.domain).toBe("app.example.com");
    expect(domain.status).toBe("pending");
    expect(instructions.cname?.value).toBe(cnameTarget("sam-r"));
    await expect(addDomain(userId, { serverId, domain: "app.example.com", port: 3001 })).rejects.toMatchObject({ status: 409 });
    await removeDomain(userId, domain.id);
    await expect(removeDomain(userId, domain.id)).rejects.toMatchObject({ status: 404 });
  });

  it("refuses reserved and foreign Nest names with a clear message", async () => {
    await expect(addDomain(userId, { serverId, domain: "admin.hackclub.app", port: 3000 })).rejects.toMatchObject({
      status: 400,
      message: "That name is reserved. Choose another domain.",
    });
    await expect(addDomain(userId, { serverId, domain: "nest.hackclub.app", port: 3000 })).rejects.toMatchObject({ status: 400 });
    await expect(addDomain(userId, { serverId, domain: "kim.hackclub.app", port: 3000 })).rejects.toMatchObject({
      status: 400,
      message: "Only your Nest name, sam-r.hackclub.app, can be used under hackclub.app.",
    });
    await expect(addDomain(userId, { serverId, domain: "printer.local", port: 3000 })).rejects.toMatchObject({ status: 400 });
  });

  it("refuses a Nest name on a server that was never connected, so nobody can claim another's name", async () => {
    const unconnected = (await createServer(userId, "not-yet-sam")).id;
    await expect(addDomain(userId, { serverId: unconnected, domain: "not-yet-sam.hackclub.app", port: 3000 }))
      .rejects.toMatchObject({ status: 400 });
    const claimed = await ctx.db.select().from(schema.domains).where(eq(schema.domains.domain, "not-yet-sam.hackclub.app")).get();
    expect(claimed).toBeUndefined();
  });

  it("accepts your own Nest name as active, with no DNS check", async () => {
    const { domain, instructions } = await addDomain(userId, { serverId, domain: "sam-r.hackclub.app", port: 3000 });
    expect(domain.status).toBe("valid");
    expect(instructions.cname).toBeNull();
    await removeDomain(userId, domain.id);
  });

  it("keeps a custom domain pending until DNS passes", async () => {
    const { domain } = await addDomain(userId, { serverId, domain: "wait.example.net", port: 3000 });
    expect(domain.status).toBe("pending");
    await removeDomain(userId, domain.id);
  });

  it("accepts a subdomain of a verified domain without a new check, but not of a pending one", async () => {
    const parent = (await addDomain(userId, { serverId, domain: "owned.example.org", port: 3000 })).domain;
    const early = await addDomain(userId, { serverId, domain: "early.owned.example.org", port: 3000 });
    expect(early.domain.status).toBe("pending");
    await verifyDomain(userId, parent.id, resolverFor(["sam-r.hackclub.app"]));
    const sub = await addDomain(userId, { serverId, domain: "api.owned.example.org", port: 3001 });
    expect(sub.domain.status).toBe("valid");
    expect(sub.instructions.cname).toBeNull();
    for (const d of [sub.domain, early.domain, parent]) await removeDomain(userId, d.id);
  });

  it("refuses a domain on another user's server with the same message, naming no one", async () => {
    const kim = (await upsertUser({ id: "u3", name: "Kim", email: null, slackId: null })).id;
    const kimServer = (await createServer(kim, "kim-k")).id;
    const mine = await addDomain(userId, { serverId, domain: "taken.example.dev", port: 3000 });
    const err = await addDomain(kim, { serverId: kimServer, domain: "taken.example.dev", port: 3000 }).catch((e) => e);
    expect(err).toMatchObject({ status: 409, message: "taken.example.dev is already added." });
    expect(err.message).not.toMatch(/sam|u1/i);
    await removeDomain(userId, mine.domain.id);
  });

  it("will not attach a domain to someone else's server", async () => {
    const other = (await upsertUser({ id: "u2", name: "Kim", email: null, slackId: null })).id;
    await expect(addDomain(other, { serverId, domain: "kim.example.com", port: 3000 })).rejects.toMatchObject({ status: 404 });
  });

  it("reclaims a pending claim left by another user for over seven days", async () => {
    const squatter = (await upsertUser({ id: "u-stale", name: "Stale", email: null, slackId: null })).id;
    const squatterServer = (await createServer(squatter, "stale-r")).id;
    const stale = await addDomain(squatter, { serverId: squatterServer, domain: "stale.example.com", port: 3000 });
    expect(stale.domain.status).toBe("pending");
    const db = await getDb();
    await db.update(schema.domains)
      .set({ createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000), updatedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) })
      .where(eq(schema.domains.id, stale.domain.id));

    const mine = await addDomain(userId, { serverId, domain: "stale.example.com", port: 3000 });
    expect(mine.domain).toMatchObject({ domain: "stale.example.com", userId, status: "pending" });
    expect(await db.select().from(schema.domains).where(eq(schema.domains.domain, "stale.example.com"))).toHaveLength(1);
    await removeDomain(userId, mine.domain.id);
  });

  it("reclaims an old pending claim even when its owner keeps re-pointing or checking it", async () => {
    const other = (await upsertUser({ id: "u-active", name: "Active", email: null, slackId: null })).id;
    const otherServer = (await createServer(other, "active-r")).id;
    const added = await addDomain(other, { serverId: otherServer, domain: "old-but-ours.example.com", port: 3000 });
    const db = await getDb();
    // Added outside the reclaim window, but the owner still presses Check and re-points it
    // today. Only `createdAt` counts, so neither action can keep the claim alive.
    await db.update(schema.domains)
      .set({
        createdAt: new Date(Date.now() - PENDING_CLAIM_MAX_AGE_MS - 60_000),
        updatedAt: new Date(),
        lastCheckedAt: new Date(),
      })
      .where(eq(schema.domains.id, added.domain.id));
    await updateDomain(other, added.domain.id, { port: 3001 });

    const mine = await addDomain(userId, { serverId, domain: "old-but-ours.example.com", port: 3002 });
    expect(mine.domain).toMatchObject({ domain: "old-but-ours.example.com", userId, status: "pending", port: 3002 });
    expect(await db.select().from(schema.domains).where(eq(schema.domains.domain, "old-but-ours.example.com"))).toHaveLength(1);
    await removeDomain(userId, mine.domain.id);
  });

  it("lets the owner reclaim their own stale pending row", async () => {
    const db = await getDb();
    const stale = await addDomain(userId, { serverId, domain: "my-stale.example.net", port: 3000 });
    await db.update(schema.domains)
      .set({ createdAt: new Date(Date.now() - PENDING_CLAIM_MAX_AGE_MS - 60_000), updatedAt: new Date() })
      .where(eq(schema.domains.id, stale.domain.id));

    const fresh = await addDomain(userId, { serverId, domain: "my-stale.example.net", port: 4000 });
    expect(fresh.domain.id).not.toBe(stale.domain.id);
    expect(fresh.domain.port).toBe(4000);
    expect(fresh.domain.status).toBe("pending");
    expect(await db.select().from(schema.domains).where(eq(schema.domains.domain, "my-stale.example.net"))).toHaveLength(1);
    await removeDomain(userId, fresh.domain.id);
  });

  it("keeps a fresh pending claim by the same user reserved", async () => {
    const fresh = await addDomain(userId, { serverId, domain: "my-fresh.example.net", port: 3000 });
    await expect(addDomain(userId, { serverId, domain: "my-fresh.example.net", port: 3001 })).rejects.toMatchObject({ status: 409 });
    await removeDomain(userId, fresh.domain.id);
  });

  it("refuses arbitrary subdomains of Hack Club's other suffixes, but allows a verified one", async () => {
    await expect(addDomain(userId, { serverId, domain: "club.hackclub.com", port: 3000 })).rejects.toMatchObject({
      status: 400,
      message: "That name is reserved. Choose another domain.",
    });
    await expect(addDomain(userId, { serverId, domain: "club.hackclub.dev", port: 3000 })).rejects.toMatchObject({ status: 400 });

    const db = await getDb();
    // A verified row under the protected suffix can only exist if it was proved by DNS;
    // insert one directly to stand in for a domain this user legitimately owns.
    await db.insert(schema.domains).values({
      id: "owned-protected-suffix",
      userId,
      serverId,
      domain: "owned-club.hackclub.com",
      port: 3000,
      status: "valid",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const sub = await addDomain(userId, { serverId, domain: "app.owned-club.hackclub.com", port: 3001 });
    expect(sub.domain.domain).toBe("app.owned-club.hackclub.com");
    await removeDomain(userId, sub.domain.id);
    await removeDomain(userId, "owned-protected-suffix");
  });

  it("keeps a recent pending claim by another user reserved", async () => {
    const other = (await upsertUser({ id: "u-fresh", name: "Fresh", email: null, slackId: null })).id;
    const otherServer = (await createServer(other, "fresh-r")).id;
    const fresh = await addDomain(other, { serverId: otherServer, domain: "fresh.example.com", port: 3000 });
    await expect(addDomain(userId, { serverId, domain: "fresh.example.com", port: 3000 })).rejects.toMatchObject({ status: 409 });
    await removeDomain(other, fresh.domain.id);
  });

  it("keeps a verified domain by another user reserved", async () => {
    const other = (await upsertUser({ id: "u-valid", name: "Valid", email: null, slackId: null })).id;
    const otherServer = (await createServer(other, "valid-r")).id;
    const valid = await addDomain(other, { serverId: otherServer, domain: "verified.example.net", port: 3000 });
    const db = await getDb();
    await db.update(schema.domains).set({ status: "valid" }).where(eq(schema.domains.id, valid.domain.id));
    await expect(addDomain(userId, { serverId, domain: "verified.example.net", port: 3000 })).rejects.toMatchObject({ status: 409 });
    await removeDomain(other, valid.domain.id);
  });
});

function resolverFor(cname: string[] | Error, a: string[] | Error = [], txt: string[][] | Error = dnsError("ENODATA")): Resolver {
  return {
    resolveCname: async () => {
      if (cname instanceof Error) throw cname;
      return cname;
    },
    resolve4: async () => {
      if (a instanceof Error) throw a;
      return a;
    },
    resolveTxt: async () => {
      if (txt instanceof Error) throw txt;
      return txt;
    },
  };
}

describe("DNS check", () => {
  const resolver = resolverFor;

  it("is valid when the CNAME points at the Nest account", async () => {
    const { domain } = await addDomain(userId, { serverId, domain: "ok.example.com", port: 3000 });
    const r = await verifyDomain(userId, domain.id, resolver(["sam-r.hackclub.app."]));
    expect(r.status).toBe("valid");
  });

  it("explains a CNAME that points elsewhere", async () => {
    const { domain } = await addDomain(userId, { serverId, domain: "bad.example.com", port: 3000 });
    const r = await verifyDomain(userId, domain.id, resolver(["someone-else.hackclub.app"]));
    expect(r.status).toBe("invalid");
    expect(r.reason).toContain("sam-r.hackclub.app");
  });

  it("says when nothing is configured yet", async () => {
    const { domain } = await addDomain(userId, { serverId, domain: "new.example.com", port: 3000 });
    const r = await verifyDomain(userId, domain.id, resolver(dnsError("ENODATA")));
    expect(r.status).toBe("invalid");
    expect(r.reason).toContain("No CNAME found");
    expect(r.reason).toContain("domain-verification=sam-r");
  });

  it("accepts the TXT record Nest accepts, even with no CNAME", async () => {
    const { domain } = await addDomain(userId, { serverId, domain: "txt.example.com", port: 3000 });
    const ok = await verifyDomain(userId, domain.id, resolver(dnsError("ENODATA"), [], [["domain-verification=sam-r"]]));
    expect(ok.status).toBe("valid");
    expect(txtValue("sam-r")).toBe("domain-verification=sam-r");
  });

  it("reads a TXT value split across strings, and rejects another account's value", async () => {
    const split = await addDomain(userId, { serverId, domain: "split.example.com", port: 3000 });
    const splitResult = await verifyDomain(userId, split.domain.id, resolver(dnsError("ENODATA"), [], [["domain-verification=", "sam-r"]]));
    expect(splitResult.status).toBe("valid");
    const other = await addDomain(userId, { serverId, domain: "other.example.com", port: 3000 });
    const otherResult = await verifyDomain(userId, other.domain.id, resolver(dnsError("ENODATA"), [], [["domain-verification=kim-k"]]));
    expect(otherResult.status).toBe("invalid");
  });

  it("says unknown, not a verdict, when the lookup itself fails, and changes nothing", async () => {
    const { domain } = await addDomain(userId, { serverId, domain: "flaky.example.com", port: 3000 });
    const db = await getDb();
    const stored = async () => (await db.select().from(schema.domains).where(eq(schema.domains.id, domain.id)).get())!;
    const timedOut = await verifyDomain(userId, domain.id, resolver(dnsError("ETIMEOUT")));
    expect(timedOut.status).toBe("unknown");
    expect(timedOut.reason).toContain("could not be checked");
    expect((await stored()).status).toBe("pending");
    await verifyDomain(userId, domain.id, resolver(["sam-r.hackclub.app"]));
    const lost = await verifyDomain(userId, domain.id, resolver(dnsError("ETIMEOUT")));
    expect(lost.status).toBe("unknown");
    expect(lost.reason).toContain("could not be checked");
    expect((await stored()).status).toBe("valid");
  });

  it("goes active on a pass, stays waiting on a miss, and flags a lost record without deleting it", async () => {
    const { domain } = await addDomain(userId, { serverId, domain: "life.example.com", port: 3000 });
    const db = await getDb();
    const stored = async () => (await db.select().from(schema.domains).where(eq(schema.domains.id, domain.id)).get())!.status;
    await verifyDomain(userId, domain.id, resolver(dnsError("ENODATA")));
    expect(await stored()).toBe("pending");
    await verifyDomain(userId, domain.id, resolver(["sam-r.hackclub.app"]));
    expect(await stored()).toBe("valid");
    await verifyDomain(userId, domain.id, resolver(dnsError("ETIMEOUT")));
    expect(await stored()).toBe("valid");
    const lost = await verifyDomain(userId, domain.id, resolver(dnsError("ENODATA")));
    expect(lost.status).toBe("invalid");
    expect(await stored()).toBe("invalid");
  });

  it("treats a subdomain of a verified domain as verified", async () => {
    const parent = await addDomain(userId, { serverId, domain: "p.example.io", port: 3000 });
    await verifyDomain(userId, parent.domain.id, resolver(["sam-r.hackclub.app"]));
    const child = await addDomain(userId, { serverId, domain: "c.p.example.io", port: 3000 });
    const r = await verifyDomain(userId, child.domain.id, resolver(dnsError("ENODATA")));
    expect(r.status).toBe("valid");
  });

  it("accepts a name Nest hands out once it resolves", async () => {
    const { domain } = await addDomain(userId, { serverId, domain: "poorup.sam-r.hackclub.app", port: 8080 });
    const r = await verifyDomain(userId, domain.id, resolver(dnsError("ENODATA"), ["203.0.113.7"]));
    expect(r.status).toBe("valid");
  });

  it("keeps the answer and the stored status in agreement for a Nest name DNS cannot see", async () => {
    const { domain } = await addDomain(userId, { serverId, domain: "unresolved.sam-r.hackclub.app", port: 3000 });
    const db = await getDb();
    const read = async () => (await db.select().from(schema.domains).where(eq(schema.domains.id, domain.id)).get())!;
    const before = (await read()).updatedAt;
    const r = await verifyDomain(userId, domain.id, resolver(dnsError("ENODATA")));
    expect(r.status).toBe("valid");
    expect((await read()).status).toBe("valid");
    expect((await read()).updatedAt).toEqual(before);
    expect(r.reason).toContain("Nest dashboard");
  });

  it("never calls a Nest name invalid, even after a port change left it pending", async () => {
    const { domain } = await addDomain(userId, { serverId, domain: "pending-nest.sam-r.hackclub.app", port: 3000 });
    const db = await getDb();
    await db.update(schema.domains).set({ status: "pending" }).where(eq(schema.domains.id, domain.id));
    const r = await verifyDomain(userId, domain.id, resolver(dnsError("ENODATA")));
    expect(r.status).toBe("unknown");
    expect((await db.select().from(schema.domains).where(eq(schema.domains.id, domain.id)).get())!.status).toBe("pending");
  });

  it("only refreshes the stale-claim clock when verification actually succeeds", async () => {
    const { domain } = await addDomain(userId, { serverId, domain: "clock.example.com", port: 3000 });
    const db = await getDb();
    const read = async () => (await db.select().from(schema.domains).where(eq(schema.domains.id, domain.id)).get())!;
    const before = (await read()).updatedAt;

    const missing = await verifyDomain(userId, domain.id, resolver(dnsError("ENODATA")));
    expect(missing.status).toBe("invalid");
    const afterMissing = await read();
    expect(afterMissing.status).toBe("pending");
    expect(afterMissing.updatedAt).toEqual(before);
    expect(afterMissing.lastCheckedAt).not.toBeNull();

    const unknown = await verifyDomain(userId, domain.id, resolver(dnsError("ETIMEOUT")));
    expect(unknown.status).toBe("unknown");
    expect((await read()).updatedAt).toEqual(before);

    await verifyDomain(userId, domain.id, resolver(["sam-r.hackclub.app"]));
    expect((await read()).updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });
});

describe("active domain re-check", () => {
  const row = (id: string, domain: string, status = "valid", nestUsername = "sam-r") => ({ id, domain, status, nestUsername });

  it("warns only for active custom domains whose record is gone", async () => {
    clearDnsCache();
    const warned = await activeDomainWarnings(
      [row("a", "a.example.com"), row("b", "b.example.com", "pending"), row("c", "x.sam-r.hackclub.app")],
      resolverFor(dnsError("ENODATA"))
    );
    expect([...warned]).toEqual(["a"]);
  });

  it("says nothing when the record is there or the lookup fails", async () => {
    clearDnsCache();
    expect((await activeDomainWarnings([row("a", "ok.example.com")], resolverFor(["sam-r.hackclub.app"]))).size).toBe(0);
    clearDnsCache();
    expect((await activeDomainWarnings([row("a", "slow.example.com")], resolverFor(dnsError("ETIMEOUT")))).size).toBe(0);
  });

  it("caches an answer for a minute", async () => {
    clearDnsCache();
    let calls = 0;
    const counting: Resolver = {
      ...resolverFor(dnsError("ENODATA")),
      resolveCname: async () => {
        calls++;
        throw dnsError("ENODATA");
      },
    };
    await activeDomainWarnings([row("a", "cache.example.com")], counting);
    await activeDomainWarnings([row("a", "cache.example.com")], counting);
    expect(calls).toBe(1);
  });

  it("makes a subdomain follow its verified parent", async () => {
    clearDnsCache();
    const warned = await activeDomainWarnings(
      [row("p", "follow.example.com"), row("c", "api.follow.example.com")],
      resolverFor(dnsError("ENODATA"))
    );
    expect([...warned].sort()).toEqual(["c", "p"]);
  });

  it("never warns about a Nest name, even after a missing DNS result was cached", async () => {
    clearDnsCache();
    const { domain } = await addDomain(userId, { serverId, domain: "warnless.sam-r.hackclub.app", port: 3000 });
    await verifyDomain(userId, domain.id, resolverFor(dnsError("ENODATA")));
    const warned = await activeDomainWarnings(
      [row(domain.id, domain.domain, "valid")],
      resolverFor(dnsError("ENODATA"))
    );
    expect(warned.size).toBe(0);
    await removeDomain(userId, domain.id);
  });
});
