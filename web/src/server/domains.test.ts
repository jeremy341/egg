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
  removeDomain,
  txtValue,
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
});
