import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { open } from "@/server/crypto";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import { runDeployJob, type PipelineDeps } from "@/server/deploy/pipeline";
import { serverDiscriminator, unitName } from "@/server/deploy/layout";
import { createProject, deployBranch, deploymentLogs, type ProjectRow } from "@/server/projects";
import { removeProjectFromServer } from "@/server/runtime-info";
import { connectToServer, createServer, getServerForUser, type ServerRow } from "@/server/servers";
import { NestSession } from "@/server/ssh/connection";
import { fakeBuilder, freePort, containerReadyFacts, installFakeContainerBuild, installFakeSystemd, nodeApp } from "@/server/test/fake-nest";
import { useFreshDb } from "@/server/test/db";
import { linuxTestHostAvailable, startMockSsh, type MockSsh } from "@/server/test/mock-ssh";

/**
 * Adopting a container that already runs things: a first deploy must never
 * overwrite, stop or remove what the user put there, and must not start a
 * second copy of an app that is already running.
 */

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let mock: MockSsh;
let userId: string;
let server: ServerRow;
let scope = "";
let deps: PipelineDeps;
let home: string;
const scopedUnit = (slug: string) => unitName(slug, undefined, scope);

async function sh(command: string) {
  const s = await NestSession.connect({
    host: "127.0.0.1",
    port: mock.port,
    username: "sam-r",
    privateKey: open(server.privateKeyEnc, `server:${server.id}`),
  });
  try {
    return (await s.exec(command)).stdout.trim();
  } finally {
    s.close();
  }
}

async function makeProject(slug: string, repoFullName = "owner/demo"): Promise<ProjectRow> {
  return createProject(userId, {
    serverId: server.id,
    name: slug,
    slug,
    repoUrl: `https://github.com/${repoFullName}`,
    repoFullName,
    runtime: "node",
    startCommand: "node server.js",
    port: await freePort(),
    healthPath: "/",
  });
}

async function deploy(project: ProjectRow) {
  const dep = await deployBranch(userId, project.id, project.productionBranch);
  await runDeployJob(dep.id, deps);
  const row = (await ctx.db.select().from(schema.deployments).where(eq(schema.deployments.id, dep.id)).get())!;
  const logs = (await deploymentLogs(userId, dep.id)).map((l) => l.message).join("\n");
  return { row, logs };
}

beforeAll(async () => {
  ctx = await useFreshDb();
  userId = (await upsertUser({ id: "u1", name: "Sam", email: null, slackId: null })).id;
  server = await createServer(userId, "sam-r", { host: "127.0.0.1", port: 1 });
  mock = await startMockSsh({ authorizedKeys: [server.publicKey] });
  installFakeSystemd(mock);
  installFakeContainerBuild(mock);
  await ctx.db.update(schema.servers).set({ port: mock.port, hostKeyFingerprint: mock.hostKeyFingerprint }).where(eq(schema.servers.id, server.id));
  server = await getServerForUser(userId, server.id);
  scope = serverDiscriminator(server.id);
  home = mock.home.replace(/\\/g, "/");
  deps = {
    preflight: () => async () => containerReadyFacts,
    lockPollMs: 50,
    sourceBuild: fakeBuilder(() => nodeApp("v1")),
    connect: connectToServer,
    unitDir: `${home}/units`,
    healthTimeoutSeconds: 8,
  };
});

afterAll(async () => {
  for (const unit of (await sh("ls $HOME/units 2>/dev/null || true")).split(/\s+/).filter(Boolean)) {
    await sh(`systemctl stop ${unit}`).catch(() => {});
  }
  await sh("pkill -f egg-adopt-listener || true").catch(() => {});
  await mock.stop();
  await ctx.cleanup();
});

describe.skipIf(!linuxTestHostAvailable())("a unit that is not ours", () => {
  it("is never overwritten, and nothing else is created", async () => {
    const p = await makeProject("clash");
    mock.writeFile(`${home}/units/${scopedUnit("clash")}`, "[Service]\nExecStart=/usr/bin/true\n");
    const { row } = await deploy(p);
    expect(row.state).toBe("error");
    expect(row.error).toContain(scopedUnit("clash"));
    expect(await sh(`cat ${home}/units/${scopedUnit("clash")}`)).toBe("[Service]\nExecStart=/usr/bin/true");
    expect(await sh(`[ -e ${home}/.egg/clash ] && echo made || echo none`)).toBe("none");
  });
});

describe.skipIf(!linuxTestHostAvailable())("a folder that is not ours", () => {
  it("keeps a user's git checkout at ~/.egg/<slug> untouched and refuses to deploy", async () => {
    const p = await makeProject("mycheckout");
    mock.writeFile(`${home}/.egg/mycheckout/.git/config`, '[remote "origin"]\n\turl = https://github.com/owner/demo\n');
    mock.writeFile(`${home}/.egg/mycheckout/server.js`, "// mine");
    const { row } = await deploy(p);
    expect(row.state).toBe("error");
    expect(row.error).toMatch(/checkout|not created by Egg/);
    expect(await sh(`cat ${home}/.egg/mycheckout/server.js`)).toBe("// mine");
    expect(await sh(`ls ${home}/.egg/mycheckout`)).not.toContain("releases");
  });

  it("refuses a folder that is a symlink instead of writing through it", async () => {
    const p = await makeProject("linked");
    await sh(`mkdir -p ${home}/elsewhere && mkdir -p ${home}/.egg && ln -s ${home}/elsewhere ${home}/.egg/linked`);
    const { row } = await deploy(p);
    expect(row.state).toBe("error");
    expect(await sh(`ls -A ${home}/elsewhere | wc -l`)).toBe("0");
  });

  it("is not removed with the project, even when asked to delete data", async () => {
    const p = await makeProject("keepme");
    mock.writeFile(`${home}/.egg/keepme/notes.txt`, "precious");
    mock.writeFile(`${home}/units/${scopedUnit("keepme")}`, "[Service]\nExecStart=/usr/bin/true\n");
    await expect(removeProjectFromServer(userId, p.id, { deleteData: true, unitDir: `${home}/units` })).rejects.toThrow(
      "Could not remove the project from your container."
    );
    expect(await sh(`cat ${home}/.egg/keepme/notes.txt`)).toBe("precious");
    expect(await sh(`cat ${home}/units/${scopedUnit("keepme")}`)).toContain("ExecStart=/usr/bin/true");
  });
});

describe.skipIf(!linuxTestHostAvailable())("a port that is already taken", () => {
  it("refuses the deploy and leaves the other process running", async () => {
    const p = await makeProject("busyport");
    await sh(
      `setsid nohup node -e "require('http').createServer((q,r)=>r.end('theirs')).listen(${p.port},'0.0.0.0'); /* egg-adopt-listener */" >/dev/null 2>&1 < /dev/null & sleep 1`
    );
    const { row } = await deploy(p);
    expect(row.state).toBe("error");
    expect(row.error).toContain(String(p.port));
    expect(await sh(`curl -s --max-time 3 http://127.0.0.1:${p.port}/`)).toBe("theirs");
    expect(await sh(`[ -e ${home}/units/${scopedUnit("busyport")} ] && echo made || echo none`)).toBe("none");
  });
});

describe.skipIf(!linuxTestHostAvailable())("the same repo already running by hand", () => {
  it("does not start a second copy next to a running systemd unit", async () => {
    const p = await makeProject("twice");
    const appDir = `${home}/app`;
    mock.writeFile(`${appDir}/.git/config`, '[remote "origin"]\n\turl = https://github.com/Owner/Demo.git\n');
    mock.writeFile(`${appDir}/server.js`, "// theirs");
    mock.writeFile(
      `${home}/units/myapp.service`,
      `[Service]\nWorkingDirectory=${appDir}\nExecStart=/bin/bash -lc "exec sleep 600"\nEnvironment=PORT=${await freePort()}\n`
    );
    await sh("systemctl start myapp.service");
    const { row } = await deploy(p);
    await sh("systemctl stop myapp.service");
    expect(row.state).toBe("error");
    expect(row.error).toContain("myapp.service");
    expect(await sh(`[ -e ${home}/units/${scopedUnit("twice")} ] && echo made || echo none`)).toBe("none");
  });
});

describe.skipIf(!linuxTestHostAvailable())("the user's own keys", () => {
  it("are byte for byte the same after a deploy", async () => {
    const p = await makeProject("clean");
    mock.writeFile(`${home}/.ssh/config`, "Host gh\n  IdentityFile ~/.ssh/deploy_key\n");
    mock.writeFile(`${home}/.ssh/authorized_keys`, "ssh-ed25519 AAAAuser user@laptop\n");
    mock.writeFile(`${home}/.ssh/known_hosts`, "github.com ssh-ed25519 AAAAhost\n");
    mock.writeFile(`${home}/.ssh/deploy_key`, "PRIVATE-KEY-OF-THE-USER\n");
    const sum = () => sh(`cd ${home}/.ssh && sha256sum config authorized_keys known_hosts deploy_key`);
    const before = await sum();
    const { row, logs } = await deploy(p);
    expect(row.state, logs).toBe("ready");
    expect(await sum()).toBe(before);
  });

  it("deploys fine next to a checkout of the same repo that is not running, and marks what it made", async () => {
    const p = await makeProject("alongside");
    mock.writeFile(`${home}/old-clone/.git/config`, '[remote "origin"]\n\turl = https://github.com/owner/demo\n');
    const { row, logs } = await deploy(p);
    expect(row.state, logs).toBe("ready");
    expect(await sh(`cat ${home}/units/${scopedUnit("alongside")}`)).toContain("# egg:managed");
    expect(await sh(`ls -A ${home}/.egg/alongside`)).toContain(".egg-managed");
    expect(await sh(`ls ${home}/old-clone/.git`)).toBe("config");
    // A second deploy of our own project is not mistaken for a conflict.
    const again = await deploy(p);
    expect(again.row.state, again.logs).toBe("ready");
  });
});
