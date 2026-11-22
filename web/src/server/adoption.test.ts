import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import type { ZodError } from "zod";
import type { SessionUser } from "@/server/auth/session";
import { zodToHttp } from "@/server/http";
import { upsertUser } from "@/server/auth/session";
import { blockingConflicts, checkProjectConflicts, detectConflicts, repoNameOf } from "@/server/adoption";
import { schema } from "@/server/db";
import { resetConfigForTests } from "@/server/config";
import { rateLimiter } from "@/server/rate-limit";
import { createProject } from "@/server/projects";
import { createServer, getServerForUser, type ServerRow } from "@/server/servers";
import { serverDiscriminator, unitName } from "@/server/deploy/layout";
import { NestSession } from "@/server/ssh/connection";
import { open } from "@/server/crypto";
import {
  adoptionScript,
  parseAdoption,
  type AdoptionRaw,
} from "@/server/ssh/adoption-probe";
import { installFakeSystemd } from "@/server/test/fake-nest";
import { useFreshDb } from "@/server/test/db";
import { linuxTestHostAvailable, startMockSsh, type MockSsh } from "@/server/test/mock-ssh";

let signedIn: SessionUser | null = null;
vi.mock("@/server/auth/current", () => ({ getCurrentUser: async () => signedIn }));

const empty = (extra: Partial<AdoptionRaw> = {}): AdoptionRaw => ({
  home: "/home/sam",
  unitFile: null,
  own: { pid: null, controlGroup: null, loaded: false },
  folder: null,
  ports: [],
  portsSource: "ss",
  processes: [],
  units: [],
  checkouts: [],
  ...extra,
});
const ctx0 = { slug: "blog", unit: "egg-blog.service", port: 3000, repo: "sam/blog" };

describe("detectConflicts", () => {
  it("finds nothing on a clean container", () => {
    expect(detectConflicts(empty(), ctx0)).toEqual([]);
  });

  it("blocks on a unit with our name that we did not write, and never calls it ours", () => {
    const [c] = detectConflicts(empty({ unitFile: { managed: false, active: "active" } }), ctx0);
    expect(c).toMatchObject({ kind: "unit", name: "egg-blog.service", blocking: true, managedByEgg: false });
  });

  it("does not block on our own leftover unit and folder", () => {
    const found = detectConflicts(
      empty({
        unitFile: { managed: true, active: "inactive" },
        folder: { kind: "dir", managed: true, git: false, entries: 3 },
      }),
      ctx0
    );
    expect(found).toHaveLength(2);
    expect(found.every((c) => !c.blocking && c.managedByEgg)).toBe(true);
  });

  it("blocks on a systemd unit of that name loaded from somewhere else", () => {
    const [c] = detectConflicts(empty({ own: { pid: null, controlGroup: null, loaded: true } }), ctx0);
    expect(c.blocking).toBe(true);
  });

  it("treats a git checkout, a link and a folder with files at our path as blocking", () => {
    const at = (folder: AdoptionRaw["folder"]) => detectConflicts(empty({ folder }), ctx0)[0];
    expect(at({ kind: "dir", managed: false, git: true, entries: 4 })).toMatchObject({ kind: "checkout", blocking: true });
    expect(at({ kind: "link" })).toMatchObject({ kind: "folder", blocking: true });
    expect(at({ kind: "dir", managed: false, git: false, entries: 2 })).toMatchObject({ kind: "folder", blocking: true });
    expect(at({ kind: "dir", managed: false, git: false, entries: 0 })).toBeUndefined();
  });

  it("blocks on a port held by something else, and not on our own service", () => {
    const other = detectConflicts(
      empty({ ports: [{ port: 3000, address: "0.0.0.0", process: "node", pid: 50, cgroups: ["/user.slice"] }] }),
      ctx0
    );
    expect(other[0]).toMatchObject({ kind: "port", blocking: true });
    expect(other[0].detail).toContain("node");

    const own = detectConflicts(
      empty({
        unitFile: { managed: true, active: "active" },
        own: { pid: 50, controlGroup: "/system.slice/egg-blog.service", loaded: true },
        ports: [{ port: 3000, address: "0.0.0.0", process: "node", pid: 51, cgroups: ["/system.slice/egg-blog.service"] }],
      }),
      ctx0
    );
    expect(own.some((c) => c.kind === "port")).toBe(false);
  });

  it("does not block our own port holder when ss names only an unrelated port", () => {
    // The holder on our port has no pid (ss could not attribute it), but a listener on
    // another port does. haveNames must be scoped to this port's holders, or the ownUp
    // fallback is disabled and our own Egg holder is misread as a foreign conflict.
    const found = detectConflicts(
      empty({
        unitFile: { managed: true, active: "active" },
        own: { pid: 51, controlGroup: "/system.slice/egg-blog.service", loaded: true },
        ports: [
          { port: 3000, address: "0.0.0.0", process: "node", pid: null, cgroups: [] },
          { port: 4000, address: "0.0.0.0", process: "node", pid: 999, cgroups: ["/user.slice"] },
        ],
      }),
      ctx0
    );
    expect(found.some((c) => c.kind === "port")).toBe(false);
  });

  it("still blocks an unattributed port holder when our own service is not running", () => {
    const found = detectConflicts(
      empty({
        unitFile: { managed: true, active: "inactive" },
        ports: [
          { port: 3000, address: "0.0.0.0", process: "node", pid: null, cgroups: [] },
          { port: 4000, address: "0.0.0.0", process: "node", pid: 999, cgroups: ["/user.slice"] },
        ],
      }),
      ctx0
    );
    expect(found.some((c) => c.kind === "port" && c.blocking)).toBe(true);
  });

  it("says so, without blocking, when ports cannot be read", () => {
    const [c] = detectConflicts(empty({ portsSource: "none" }), ctx0);
    expect(c).toMatchObject({ kind: "port", blocking: false });
  });

  it("blocks on the same repo already running, but only for a first production deploy", () => {
    const found = detectConflicts(
      empty({
        processes: [{ pid: 9, comm: "node", cwd: "app", sameRepo: true, inTarget: false, cgroups: [] }],
        units: [{ name: "myapp.service", active: "active", cwd: "app", sameRepo: true, inTarget: false }],
        checkouts: ["app"],
      }),
      ctx0
    );
    expect(blockingConflicts(found, true).map((c) => c.kind).sort()).toEqual(["process", "unit"]);
    expect(blockingConflicts(found, false)).toEqual([]);
    expect(found.find((c) => c.kind === "checkout")).toMatchObject({ blocking: false });
  });

  it("only warns about a stopped service for the same repo, and a process that is ours is ignored", () => {
    const found = detectConflicts(
      empty({
        own: { pid: 7, controlGroup: null, loaded: true },
        processes: [{ pid: 7, comm: "node", cwd: ".egg/blog", sameRepo: false, inTarget: true, cgroups: [] }],
        units: [{ name: "old.service", active: "inactive", cwd: "app", sameRepo: true, inTarget: false }],
      }),
      ctx0
    );
    expect(found.some((c) => c.kind === "process")).toBe(false);
    expect(found.find((c) => c.name === "old.service")).toMatchObject({ blocking: false });
  });

  it("never uses a dash in its wording", () => {
    const found = detectConflicts(
      empty({
        unitFile: { managed: false, active: "active" },
        folder: { kind: "dir", managed: false, git: true, entries: 1 },
        ports: [{ port: 3000, address: "*", process: "node", pid: 1, cgroups: [] }],
        processes: [{ pid: 9, comm: "node", cwd: "app", sameRepo: true, inTarget: false, cgroups: [] }],
        checkouts: ["app"],
      }),
      ctx0
    );
    for (const c of found) expect(c.detail).not.toMatch(/[–—]/);
  });
});

describe("repoNameOf", () => {
  it("reads owner/repo from the usual forms", () => {
    expect(repoNameOf("https://github.com/sam/blog")).toBe("sam/blog");
    expect(repoNameOf("https://github.com/sam/blog.git")).toBe("sam/blog");
    expect(repoNameOf("git@github.com:sam/blog.git")).toBe("sam/blog");
    expect(repoNameOf("sam/blog")).toBe("sam/blog");
    expect(repoNameOf("https://gitlab.com/sam/blog")).toBeNull();
    expect(repoNameOf(null)).toBeNull();
  });
});

describe("the adoption probe script", () => {
  const script = adoptionScript({ unitDir: "/etc/systemd/system", slug: "blog", unit: "egg-blog.service", port: 3000, repo: "sam/blog" });

  it("only reads", () => {
    const body = script.replace(/2?>\s*\/dev\/null(\s+2>&1)?/g, "").replace(/NR>2/g, "");
    expect(body).not.toMatch(/\b(rm|mv|cp|kill|mkdir|touch|chmod|chown|tee|dd|reboot|shutdown)\b/);
    expect(body).not.toMatch(/systemctl\s+(stop|start|restart|enable|disable|daemon-reload|reset-failed|mask|kill)/);
    expect(body).not.toMatch(/(^|[^<>=-])>(?!\s*&)/m);
  });

  it("never prints command lines, environment or git remotes", () => {
    expect(script).not.toMatch(/cmdline|environ/);
    expect(script).not.toMatch(/printf 'CHECKOUT[^\n]*\$u/);
  });

  it("rejects inputs that could escape the quoting", () => {
    const base = { unitDir: "/etc/systemd/system", slug: "blog", unit: "egg-blog.service", port: 3000, repo: null };
    expect(() => adoptionScript({ ...base, slug: "a; rm -rf ~" })).toThrow();
    expect(() => adoptionScript({ ...base, unit: "egg-x.service; id" })).toThrow();
    expect(() => adoptionScript({ ...base, port: 0 })).toThrow();
    expect(() => adoptionScript({ ...base, repo: "a/b; id" })).toThrow();
  });

  it("refuses an answer that was cut short", () => {
    expect(() => parseAdoption("home=/home/sam\n")).toThrow();
  });
});

describe.skipIf(!linuxTestHostAvailable())("on a container", () => {
  let db: Awaited<ReturnType<typeof useFreshDb>>;
  let userId: string;
  let otherId: string;
  let row: ServerRow;
  let mock: MockSsh;
  let home: string;

  async function sh(command: string) {
    const key = open(row.privateKeyEnc, `server:${row.id}`);
    const s = await NestSession.connect({ host: "127.0.0.1", port: mock.port, username: "x", privateKey: key });
    try {
      return (await s.exec(command)).stdout.trim();
    } finally {
      s.close();
    }
  }

  beforeAll(async () => {
    db = await useFreshDb();
    userId = (await upsertUser({ id: "u1", name: "Sam", email: null, slackId: null })).id;
    otherId = (await upsertUser({ id: "u2", name: "Kim", email: null, slackId: null })).id;
    row = await createServer(userId, "sam-r", { host: "127.0.0.1", port: 1 });
    mock = await startMockSsh({ authorizedKeys: [row.publicKey] });
    installFakeSystemd(mock);
    await db.db.update(schema.servers).set({ port: mock.port, hostKeyFingerprint: mock.hostKeyFingerprint }).where(eq(schema.servers.id, row.id));
    row = await getServerForUser(userId, row.id);
    home = mock.home.replace(/\\/g, "/");
    process.env.UNIT_DIR = `${home}/units`;
    resetConfigForTests();
  });
  afterAll(async () => {
    delete process.env.UNIT_DIR;
    resetConfigForTests();
    await mock?.stop();
    await db.cleanup();
  });

  it("reports an unmanaged unit and folder, a checkout and a running copy, and changes nothing", async () => {
    const scoped = unitName("blog", undefined, serverDiscriminator(row.id));
    mock.writeFile(`${home}/units/${scoped}`, "[Service]\nExecStart=/usr/bin/true\n");
    mock.writeFile(`${home}/.egg/blog/.git/config`, "[core]\n");
    mock.writeFile(`${home}/app/.git/config`, '[remote "origin"]\n\turl = https://x-access-token:SECRET@github.com/sam/blog.git\n');
    mock.writeFile(`${home}/units/mine.service`, `[Service]\nWorkingDirectory=${home}/app\nExecStart=/bin/bash -lc "exec sleep 300"\n`);
    await sh("systemctl start mine.service");
    const before = await sh("cd $HOME && find . -path ./.shims -prune -o -path ./.fake-systemd -prune -o -type f -print | sort | xargs sha256sum");

    const found = await checkProjectConflicts(userId, row.id, { slug: "blog", port: 3000, repoFullName: "sam/blog" });
    await sh("systemctl stop mine.service");

    expect(found.find((c) => c.name === scoped)).toMatchObject({ kind: "unit", blocking: true, managedByEgg: false });
    expect(found.find((c) => c.name === "~/.egg/blog")).toMatchObject({ kind: "checkout", blocking: true });
    expect(found.find((c) => c.name === "mine.service")).toMatchObject({ kind: "unit", blocking: true });
    expect(found.find((c) => c.name === "~/app")).toMatchObject({ kind: "checkout", blocking: false });
    // A token in a git remote must never reach the answer.
    expect(JSON.stringify(found)).not.toContain("SECRET");
    const after = await sh("cd $HOME && find . -path ./.shims -prune -o -path ./.fake-systemd -prune -o -type f -print | sort | xargs sha256sum");
    expect(after).toBe(before);
  });

  it("reports a port held by another program", async () => {
    await sh(`setsid nohup node -e "require('http').createServer(()=>{}).listen(48123,'0.0.0.0'); /* egg-conflict-listener */" >/dev/null 2>&1 < /dev/null & sleep 1`);
    const found = await checkProjectConflicts(userId, row.id, { slug: "fresh", port: 48123, repoFullName: null });
    await sh("pkill -f egg-conflict-listener || true");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "port", blocking: true });
  });

  it("returns nothing on a clean slug and port", async () => {
    expect(await checkProjectConflicts(userId, row.id, { slug: "nothing-here", port: 48124 })).toEqual([]);
  });

  it("rejects a bad slug before any SSH, and a server that is not yours with 404", async () => {
    const before = mock.commands.length;
    // The parse failure is a ZodError; the route maps it with zodToHttp to a 400 "validation".
    const refusal = await checkProjectConflicts(userId, row.id, { slug: "Bad Slug", port: 3000 }).then(
      () => null,
      (err: unknown) => zodToHttp(err as ZodError)
    );
    expect(refusal).toMatchObject({
      status: 400,
      code: "validation",
      message: "slug: Use lowercase letters, digits and hyphens",
    });
    await expect(checkProjectConflicts(otherId, row.id, { slug: "ok", port: 3000 })).rejects.toMatchObject({ status: 404 });
    expect(mock.commands.length).toBe(before);
  });

  describe("the route", () => {
    const post = (body: unknown, origin = "http://localhost:3000") =>
      new NextRequest("http://localhost:3000/api/projects/conflicts", {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify(body),
      });

    it("requires sign-in", async () => {
      signedIn = null;
      const { POST } = await import("@/app/api/projects/conflicts/route");
      expect((await POST(post({ serverId: row.id, slug: "x", port: 3000 }), undefined as never)).status).toBe(401);
    });

    it("validates the body, 404s another user's server and never touches it", async () => {
      const { POST } = await import("@/app/api/projects/conflicts/route");
      signedIn = { id: userId, name: "Sam" } as SessionUser;
      expect((await POST(post({ serverId: row.id, slug: "x" }), undefined as never)).status).toBe(400);
      expect((await POST(post({ serverId: row.id, slug: "x", port: 99999 }), undefined as never)).status).toBe(400);
      const before = mock.commands.length;
      signedIn = { id: otherId, name: "Kim" } as SessionUser;
      expect((await POST(post({ serverId: row.id, slug: "x", port: 3000 }), undefined as never)).status).toBe(404);
      expect(mock.commands.length).toBe(before);
    });

    it("answers the owner, rejects a cross-origin write and rate limits", async () => {
      const { POST } = await import("@/app/api/projects/conflicts/route");
      signedIn = { id: userId, name: "Sam" } as SessionUser;
      const res = await POST(post({ serverId: row.id, slug: "nothing-here", port: 48125 }), undefined as never);
      expect(res.status).toBe(200);
      expect((await res.json()).conflicts).toEqual([]);
      expect((await POST(post({ serverId: row.id, slug: "x", port: 3000 }, "https://evil.example"), undefined as never)).status).toBe(403);

      rateLimiter().clear();
      for (let i = 0; i < 20; i++) rateLimiter().check(`projectConflicts:${userId}`, 20, 60_000);
      const before = mock.commands.length;
      const limited = await POST(post({ serverId: row.id, slug: "x", port: 3000 }), undefined as never);
      expect(limited.status).toBe(429);
      expect(limited.headers.get("Retry-After")).toBeTruthy();
      expect(mock.commands.length).toBe(before);
      rateLimiter().clear();
    });
  });
});

describe("an adopted project", () => {
  let c: Awaited<ReturnType<typeof useFreshDb>>;
  let uid: string;
  let sid: string;
  beforeAll(async () => {
    c = await useFreshDb();
    uid = (await upsertUser({ id: "u9", name: "Sam", email: null, slackId: null })).id;
    sid = (await createServer(uid, "sam-r", { host: "127.0.0.1", port: 1 })).id;
  });
  afterAll(async () => {
    await c.cleanup();
  });

  const base = () => ({
    serverId: sid,
    repoUrl: "https://github.com/sam/blog",
    runtime: "node" as const,
    port: 3000 + Math.floor(Math.random() * 1000),
  });

  it("is created with auto deploy off until the first deploy is confirmed, even if asked to turn it on", async () => {
    const p = await createProject(uid, { ...base(), name: "Adopted", slug: "adopted", adopted: true, autoDeploy: true });
    expect(p.autoDeploy).toBe(false);
  });

  it("leaves auto deploy as asked for an ordinary new project", async () => {
    const p = await createProject(uid, { ...base(), name: "Plain", slug: "plain" });
    expect(p.autoDeploy).toBe(true);
  });
});
