import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { upsertUser } from "@/server/auth/session";
import { resetConfigForTests } from "@/server/config";
import { acceptUpload, readUpload, uploadSlotsInUse, uploadsDir, type UploadOptions } from "@/server/builds/uploads";
import { createProject, deploymentLogs, enqueueDeployment, type ProjectRow } from "@/server/projects";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";
import { goodRelease, sha256Of } from "@/server/test/raw-tar";

// The receive path, the database and the files are real. The deadlines and caps are passed in small.

const COMMIT = "d".repeat(40);
let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let work: string;
let user: Awaited<ReturnType<typeof upsertUser>>;
let serverId: string;
let port = 5100;
let serial = 0;

/** A project that builds on GitHub and has nothing waiting. */
async function bareProject(): Promise<ProjectRow> {
  serial += 1;
  return createProject(user.id, {
    serverId,
    name: `Receive${serial}`,
    repoUrl: "https://github.com/example/demo",
    runtime: "node",
    port: port++,
    buildLocation: "github",
  });
}

/** A project that builds on GitHub, with a queued deployment waiting for COMMIT on main. */
async function waitingProject(): Promise<{ project: ProjectRow; deploymentId: string }> {
  const project = await bareProject();
  const dep = await enqueueDeployment(project, { env: "production", source: "webhook", branch: "main", commitSha: COMMIT, triggeredBy: user.id });
  return { project, deploymentId: dep.id };
}

const headersFor = (bytes: Buffer) => ({ commit: COMMIT, sha256: sha256Of(bytes), branch: "main", run: "9" });

const optionsFor = (
  projectId: string,
  bytes: Buffer,
  body: ReadableStream<Uint8Array> | null,
  environment: UploadOptions["environment"] = "production",
  branch = "main"
): UploadOptions => ({
  projectId,
  environment,
  headers: { ...headersFor(bytes), branch },
  body,
  contentLength: null,
});

const partFiles = () => readdirSync(uploadsDir()).filter((f) => f.startsWith("incoming-"));
const logText = async (id: string) => (await deploymentLogs(user.id, id)).map((l) => l.message).join("\n");
const GZIP_HEAD = new Uint8Array([0x1f, 0x8b]);

/** Sends the gzip header, then waits for `go` before sending the rest. Never closes if `go` never resolves. */
function gatedBody(bytes: Buffer, go: Promise<void>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array(bytes.subarray(0, 2)));
    },
    async pull(c) {
      await go;
      c.enqueue(new Uint8Array(bytes.subarray(2)));
      c.close();
    },
  });
}

/** Keeps sending one byte every `everyMs`, so the idle deadline never fires. */
function trickleBody(everyMs: number): ReadableStream<Uint8Array> {
  let timer: ReturnType<typeof setInterval> | undefined;
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(GZIP_HEAD);
      timer = setInterval(() => c.enqueue(new Uint8Array([0])), everyMs);
    },
    cancel() {
      clearInterval(timer);
    },
  });
}

/** Sends the chunks one by one, `gapMs` apart. */
function pacedBody(bytes: Buffer, gapMs: number): ReadableStream<Uint8Array> {
  const left: Buffer[] = [];
  for (let i = 0; i < bytes.length; i += 64) left.push(bytes.subarray(i, i + 64));
  return new ReadableStream<Uint8Array>({
    async pull(c) {
      const next = left.shift();
      if (!next) {
        c.close();
        return;
      }
      await new Promise((r) => setTimeout(r, gapMs));
      c.enqueue(new Uint8Array(next));
    },
  });
}

beforeAll(async () => {
  work = mkdtempSync(path.join(tmpdir(), "egg-receive-"));
  process.env.DEPLOY_WORK_DIR = work;
  ctx = await useFreshDb();
  resetConfigForTests();
  user = await upsertUser({ id: "u-receive", name: "Ria", email: null, slackId: null });
  serverId = (await createServer(user.id, "ria-r")).id;
});

afterAll(async () => {
  await ctx.cleanup();
  delete process.env.DEPLOY_WORK_DIR;
  resetConfigForTests();
  rmSync(work, { recursive: true, force: true });
});

describe("the receive deadlines", () => {
  it("cuts off a client that stops sending after the idle deadline: 408, no part-file, and the deployment log says why", async () => {
    const { project, deploymentId } = await waitingProject();
    const bytes = goodRelease();
    const err = await acceptUpload({ ...optionsFor(project.id, bytes, gatedBody(bytes, new Promise(() => {}))), idleMs: 50 }).catch((e) => e);
    expect(err).toMatchObject({ status: 408, code: "upload_stalled" });
    expect(partFiles()).toEqual([]);
    expect(await readUpload(deploymentId)).toBeNull();
    expect(uploadSlotsInUse()).toEqual({ total: 0, byProject: {} });
    expect(await logText(deploymentId)).toMatch(/rejected: The build from GitHub stopped arriving/);
  });

  it("cuts off a body that keeps trickling once the whole-upload limit is reached: 408 upload_too_long, nothing left behind", async () => {
    const { project, deploymentId } = await waitingProject();
    const bytes = goodRelease();
    const err = await acceptUpload({
      ...optionsFor(project.id, bytes, trickleBody(5)),
      idleMs: 5_000,
      maxDurationMs: 150,
    }).catch((e) => e);
    expect(err).toMatchObject({ status: 408, code: "upload_too_long" });
    expect(partFiles()).toEqual([]);
    expect(await readUpload(deploymentId)).toBeNull();
    expect(uploadSlotsInUse()).toEqual({ total: 0, byProject: {} });
  });

  it("does not cut off a slow but steady client, and a normal upload succeeds with the default limits", async () => {
    const { project, deploymentId } = await waitingProject();
    const bytes = goodRelease();
    const { deploymentId: got } = await acceptUpload({ ...optionsFor(project.id, bytes, pacedBody(bytes, 30)), idleMs: 200 });
    expect(got).toBe(deploymentId);
    expect((await readUpload(deploymentId))?.meta.sha256).toBe(sha256Of(bytes));
    expect(uploadSlotsInUse()).toEqual({ total: 0, byProject: {} });

    const second = await waitingProject();
    const plain = goodRelease([{ name: "plain.txt", content: "plain" }]);
    const res = await acceptUpload(optionsFor(second.project.id, plain, new Response(new Uint8Array(plain)).body));
    expect(res.deploymentId).toBe(second.deploymentId);
    expect(partFiles()).toEqual([]);
  });
});

describe("upload credential environment isolation", () => {
  it("rejects a preview credential for a waiting production deployment before reading the artifact", async () => {
    const { project, deploymentId } = await waitingProject();
    const bytes = goodRelease([{ name: "substituted.txt", content: "preview artifact" }]);
    let consumed = false;
    const options = optionsFor(project.id, bytes, null, "preview");
    Object.defineProperty(options, "body", {
      get() {
        consumed = true;
        return new Response(new Uint8Array(bytes)).body;
      },
    });

    const err = await acceptUpload(options).catch((e) => e);

    expect(err).toMatchObject({ status: 403, code: "wrong_upload_credential" });
    expect(consumed).toBe(false);
    expect(await readUpload(deploymentId)).toBeNull();
  });

  it("rejects a production credential for a waiting preview deployment", async () => {
    const project = await bareProject();
    const branch = "feature/demo";
    const dep = await enqueueDeployment(project, {
      env: "preview",
      source: "webhook",
      branch,
      commitSha: COMMIT,
      triggeredBy: user.id,
    });
    const bytes = goodRelease([{ name: "production artifact.txt", content: "production artifact" }]);

    const err = await acceptUpload(
      optionsFor(project.id, bytes, new Response(new Uint8Array(bytes)).body, "production", branch)
    ).catch((e) => e);

    expect(err).toMatchObject({ status: 403, code: "wrong_upload_credential" });
    expect(await readUpload(dep.id)).toBeNull();
  });

  it("accepts a preview credential only for the matching preview branch and attaches the complete build", async () => {
    const project = await bareProject();
    const branch = "feature/preview";
    const dep = await enqueueDeployment(project, {
      env: "preview",
      source: "webhook",
      branch,
      commitSha: COMMIT,
      triggeredBy: user.id,
    });
    const bytes = goodRelease([{ name: "preview.txt", content: "preview" }]);

    const result = await acceptUpload(
      optionsFor(project.id, bytes, new Response(new Uint8Array(bytes)).body, "preview", branch)
    );

    expect(result.deploymentId).toBe(dep.id);
    expect((await readUpload(dep.id))?.meta.sha256).toBe(sha256Of(bytes));
  });
});

describe("the in-flight counters", () => {
  it("are released after a failure: a checksum mismatch and a deployment that is not waiting", async () => {
    const { project, deploymentId } = await waitingProject();
    const bytes = goodRelease([{ name: "bad.txt", content: "bad" }]);
    const mismatch = await acceptUpload({
      ...optionsFor(project.id, bytes, new Response(new Uint8Array(bytes)).body),
      headers: { ...headersFor(bytes), sha256: "0".repeat(64) },
    }).catch((e) => e);
    expect(mismatch).toMatchObject({ status: 400, code: "checksum_mismatch" });
    expect(uploadSlotsInUse()).toEqual({ total: 0, byProject: {} });
    expect(await readUpload(deploymentId)).toBeNull();

    const nothing = await bareProject();
    const none = await acceptUpload(optionsFor(nothing.id, bytes, new Response(new Uint8Array(bytes)).body)).catch((e) => e);
    expect(none).toMatchObject({ status: 409 });
    expect(uploadSlotsInUse()).toEqual({ total: 0, byProject: {} });
  });
});

describe("the concurrency limits", () => {
  it("refuse one more upload with 503 and Retry-After while the others are in flight, then let them finish", async () => {
    const a = await waitingProject();
    const b = await waitingProject();
    const c = await waitingProject();
    const bytesA = goodRelease([{ name: "a.txt", content: "a" }]);
    const bytesB = goodRelease([{ name: "b.txt", content: "b" }]);
    const bytesC = goodRelease([{ name: "c.txt", content: "c" }]);
    let openA!: () => void;
    let openB!: () => void;
    const goA = new Promise<void>((r) => (openA = r));
    const goB = new Promise<void>((r) => (openB = r));
    const limits = { maxConcurrent: 2, maxPerProject: 2 };

    const pA = acceptUpload({ ...optionsFor(a.project.id, bytesA, gatedBody(bytesA, goA)), ...limits });
    const pB = acceptUpload({ ...optionsFor(b.project.id, bytesB, gatedBody(bytesB, goB)), ...limits });
    expect(uploadSlotsInUse().total).toBe(2);

    const refused = await acceptUpload({ ...optionsFor(c.project.id, bytesC, gatedBody(bytesC, goB)), ...limits }).catch((e) => e);
    expect(refused).toMatchObject({ status: 503, code: "busy", headers: { "Retry-After": "30" } });
    expect(await readUpload(c.deploymentId)).toBeNull();

    openA();
    openB();
    expect((await pA).deploymentId).toBe(a.deploymentId);
    expect((await pB).deploymentId).toBe(b.deploymentId);
    expect(uploadSlotsInUse()).toEqual({ total: 0, byProject: {} });

    // With the slots free again, the refused project's upload goes through.
    const retry = await acceptUpload({ ...optionsFor(c.project.id, bytesC, new Response(new Uint8Array(bytesC)).body), ...limits });
    expect(retry.deploymentId).toBe(c.deploymentId);
  });

  it("refuses a second upload for the same project with 429 and Retry-After while the first is in flight", async () => {
    const a = await waitingProject();
    const first = await waitingProject();
    const bytes = goodRelease([{ name: "one.txt", content: "one" }]);
    let open!: () => void;
    const go = new Promise<void>((r) => (open = r));
    const limits = { maxConcurrent: 4, maxPerProject: 1 };

    const pFirst = acceptUpload({ ...optionsFor(a.project.id, bytes, gatedBody(bytes, go)), ...limits });
    expect(uploadSlotsInUse().byProject).toEqual({ [a.project.id]: 1 });
    const refused = await acceptUpload({ ...optionsFor(a.project.id, bytes, new Response(new Uint8Array(bytes)).body), ...limits }).catch((e) => e);
    expect(refused).toMatchObject({ status: 429, code: "busy", headers: { "Retry-After": "30" } });

    // Another project is not held back by it.
    const other = await acceptUpload({ ...optionsFor(first.project.id, bytes, new Response(new Uint8Array(bytes)).body), ...limits });
    expect(other.deploymentId).toBe(first.deploymentId);

    open();
    expect((await pFirst).deploymentId).toBe(a.deploymentId);
    expect(uploadSlotsInUse()).toEqual({ total: 0, byProject: {} });
  });
});
