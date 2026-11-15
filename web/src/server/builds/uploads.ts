import { createHash, randomUUID } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import path from "node:path";
import { and, asc, eq, inArray } from "drizzle-orm";
import { BAD_BUILD_CREDENTIAL } from "@/server/builds/authorization";
import type { UploadEnvironment } from "@/server/builds/token";
import { config } from "@/server/config";
import { getDb, schema } from "@/server/db";
import { MAX_ARCHIVE_BYTES, BuildError, assertGitRef } from "@/server/deploy/build";
import { DeploymentLogger } from "@/server/deploy/logger";
import { HttpError } from "@/server/http";

/**
 * Finished releases that GitHub Actions sends. An upload is streamed to a private file under
 * DEPLOY_WORK_DIR/uploads while its SHA-256 is computed, checked against what the sender declared, and
 * only then attached to the deployment that is waiting for that commit. Attaching is two files named
 * after the deployment: `<id>.json` (what was declared) and `<id>.tar.gz` (the bytes). The first
 * attach wins; a second one for the same deployment is refused. The deploy worker picks them up from
 * there, so web and worker must share DEPLOY_WORK_DIR.
 *
 * Nothing here writes the token, the archive path or any variable value to a log.
 */

/** How long a deployment waits for the build to arrive, and how often it looks. */
export const UPLOAD_WAIT_MS = 60 * 60_000;
export const UPLOAD_POLL_MS = 10_000;
/** Uploads and part-files older than this are removed whenever a new upload arrives. */
const STALE_MS = 3 * 60 * 60_000;

/**
 * Receive limits. Without a byte for `UPLOAD_IDLE_MS` the client has stalled and the upload is cut off; the whole
 * body may take at most `UPLOAD_MAX_MS`, so a client that trickles bytes cannot hold a connection forever. At most
 * `MAX_CONCURRENT_UPLOADS` bodies are received at once across Egg, and `MAX_CONCURRENT_UPLOADS_PER_PROJECT` for one
 * project (two, so that two workflow runs of one project can overlap). A refused upload gets 503 or 429 with Retry-After.
 */
export const UPLOAD_IDLE_MS = 60_000;
export const UPLOAD_MAX_MS = 15 * 60_000;
export const MAX_CONCURRENT_UPLOADS = 4;
export const MAX_CONCURRENT_UPLOADS_PER_PROJECT = 2;
const RETRY_AFTER_SECONDS = "30";

export const WAIT_TIMEOUT_MESSAGE = "GitHub did not send the build in time. Check the workflow run, then deploy again.";

/** Raised for anything that stops a GitHub build on the Egg side; the message is shown to the owner as is. */
export class GithubBuildError extends Error {}

export type UploadMeta = {
  sha256: string;
  commit: string;
  branch: string;
  run: string;
  bytes: number;
  receivedAt: number;
};

export type UploadHeaders = { commit: string; sha256: string; branch: string; run: string };

// ----------------------------------------------------------------- files

const ID = /^[A-Za-z0-9-]{1,64}$/;

export function uploadsDir(): string {
  const dir = path.resolve(config().DEPLOY_WORK_DIR, "uploads");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function fileFor(deploymentId: string, ext: "tar.gz" | "json"): string {
  if (!ID.test(deploymentId)) throw new GithubBuildError("The deployment id is not valid.");
  return path.join(uploadsDir(), `${deploymentId}.${ext}`);
}

/** Remove what was received for a deployment. Safe when there is nothing. */
export function discardUpload(deploymentId: string): void {
  for (const ext of ["tar.gz", "json"] as const) rmSync(fileFor(deploymentId, ext), { force: true });
}

export function hasUpload(deploymentId: string): boolean {
  return existsSync(fileFor(deploymentId, "json"));
}

/** Delete uploads, sidecars and part-files nobody collected. Never throws. */
export function sweepUploads(maxAgeMs = STALE_MS): void {
  try {
    const dir = uploadsDir();
    const cutoff = Date.now() - maxAgeMs;
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      try {
        if (statSync(full).mtimeMs < cutoff) rmSync(full, { force: true });
      } catch {
        /* another request removed it first */
      }
    }
  } catch {
    /* a folder that cannot be read is retried on the next upload */
  }
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    createReadStream(file)
      .on("data", (d) => hash.update(d))
      .on("end", () => resolve())
      .on("error", reject);
  });
  return hash.digest("hex");
}

// ----------------------------------------------------------------- headers

const bad = (message: string, code = "invalid_header") => new HttpError(400, message, code);

/** X-Egg-Commit, X-Egg-Sha256, X-Egg-Branch and X-Egg-Run, each checked before any body is read. */
export function parseUploadHeaders(h: Headers): UploadHeaders {
  const commit = (h.get("x-egg-commit") ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(commit)) throw bad("X-Egg-Commit must be the 40-character commit hash.");
  const sha256 = (h.get("x-egg-sha256") ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw bad("X-Egg-Sha256 must be the 64-character SHA-256 of the archive.");
  const branch = (h.get("x-egg-branch") ?? "").trim();
  try {
    assertGitRef(branch);
  } catch (e) {
    if (e instanceof BuildError) throw bad("X-Egg-Branch is not a valid branch name.");
    throw e;
  }
  const run = (h.get("x-egg-run") ?? "").trim();
  if (!/^\d{1,20}$/.test(run)) throw bad("X-Egg-Run must be the workflow run number (digits only).");
  return { commit, sha256, branch, run };
}

// ----------------------------------------------------------------- the deployment that waits

type DeploymentRow = typeof schema.deployments.$inferSelect;

/**
 * The deployment of this project that is waiting for this commit on this branch: queued or running,
 * not a rollback, and not yet holding an upload. A deployment whose commit is not known yet (a manual
 * deploy or a deploy hook) takes the next build of its branch; one that names a commit takes only that commit.
 * `received` is a matching deployment that already holds an upload. With `environment`, only deployments of that
 * environment count: an upload credential made for preview never finds a production deployment, and the other way round.
 */
export async function findWaiting(
  projectId: string,
  branch: string,
  commit: string,
  environment?: UploadEnvironment
): Promise<{ waiting: DeploymentRow | null; received: DeploymentRow | null }> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.deployments)
    .where(
      and(
        eq(schema.deployments.projectId, projectId),
        eq(schema.deployments.branch, branch),
        inArray(schema.deployments.state, ["queued", "building"]),
        ...(environment ? [eq(schema.deployments.env, environment)] : [])
      )
    )
    .orderBy(asc(schema.deployments.createdAt));
  const matching = rows.filter((d) => d.source !== "rollback" && (d.commitSha === null || d.commitSha.toLowerCase() === commit));
  const open = matching.filter((d) => !hasUpload(d.id));
  const waiting = open.find((d) => d.commitSha !== null) ?? open[0] ?? null;
  const received = matching.find((d) => hasUpload(d.id)) ?? null;
  return { waiting, received };
}

async function eventLog(deploymentId: string, level: "info" | "warn", message: string) {
  const log = new DeploymentLogger(deploymentId);
  log.log(level, message);
  await log.flush().catch(() => {});
}

// ----------------------------------------------------------------- receiving

/**
 * Stream the request body into a private part-file, hashing as it goes. Two deadlines end a body that takes too
 * long: `idleMs` without a byte, and `maxDurationMs` for the whole body. Either answers 408 and deletes the file.
 * Every timer is cleared and the reader released on every path.
 */
async function streamToFile(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  limits: { idleMs: number; maxDurationMs: number }
): Promise<{ file: string; sha256: string; bytes: number }> {
  const file = path.join(uploadsDir(), `incoming-${randomUUID()}.part`);
  const out = createWriteStream(file, { flags: "wx", mode: 0o600 });
  const hash = createHash("sha256");
  let bytes = 0;
  let head = Buffer.alloc(0);
  // A deadline rejects this promise, which ends the read or drain it is racing. Nothing else observes it.
  let stop!: (err: HttpError) => void;
  const stopped = new Promise<never>((_, reject) => {
    stop = reject;
  });
  stopped.catch(() => {});
  let idle: ReturnType<typeof setTimeout> | undefined;
  let overall: ReturnType<typeof setTimeout> | undefined;
  try {
    if (body) {
      overall = setTimeout(
        () => stop(new HttpError(408, "The build from GitHub took too long to arrive. Run the workflow again.", "upload_too_long")),
        limits.maxDurationMs
      );
      const reader = body.getReader();
      try {
        for (;;) {
          idle = setTimeout(
            () => stop(new HttpError(408, "The build from GitHub stopped arriving. Run the workflow again.", "upload_stalled")),
            limits.idleMs
          );
          const { done, value } = await Promise.race([reader.read(), stopped]);
          clearTimeout(idle);
          if (done) break;
          bytes += value.byteLength;
          if (bytes > maxBytes) {
            await reader.cancel().catch(() => {});
            throw new HttpError(413, "That archive is too large.", "too_large");
          }
          if (head.length < 2) head = Buffer.concat([head, Buffer.from(value.subarray(0, 2 - head.length))]);
          hash.update(value);
          if (!out.write(value)) await Promise.race([once(out, "drain"), stopped]);
        }
      } finally {
        clearTimeout(idle);
        // Cancelling settles a read that a deadline left pending, so the lock can be released.
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    }
    clearTimeout(overall);
    if (bytes < 2 || head[0] !== 0x1f || head[1] !== 0x8b) {
      throw new HttpError(400, "The upload is not a gzipped tar archive (.tar.gz).", "not_gzip");
    }
    out.end();
    await finished(out);
    return { file, sha256: hash.digest("hex"), bytes };
  } catch (err) {
    out.destroy();
    // Wait for the file to close first: Windows will not delete a file that is still open.
    await finished(out).catch(() => {});
    rmSync(file, { force: true });
    throw err;
  } finally {
    clearTimeout(idle);
    clearTimeout(overall);
  }
}

// ----------------------------------------------------------------- concurrency

const inFlight = { total: 0, byProject: new Map<string, number>() };

/** How many uploads are being received now. For tests and status checks; never a limit by itself. */
export function uploadSlotsInUse(): { total: number; byProject: Record<string, number> } {
  return { total: inFlight.total, byProject: Object.fromEntries(inFlight.byProject) };
}

/**
 * Reserve a receive slot, or throw 503 when Egg is full or 429 when this project is. The returned function frees the
 * slot; calling it again does nothing.
 */
function takeUploadSlot(projectId: string, maxTotal: number, maxPerProject: number): () => void {
  const mine = inFlight.byProject.get(projectId) ?? 0;
  if (inFlight.total >= maxTotal) {
    throw new HttpError(503, "Egg is receiving as many builds as it can right now. Try again in a minute.", "busy", {
      "Retry-After": RETRY_AFTER_SECONDS,
    });
  }
  if (mine >= maxPerProject) {
    throw new HttpError(429, "A build for this project is already arriving. Try again in a minute.", "busy", {
      "Retry-After": RETRY_AFTER_SECONDS,
    });
  }
  inFlight.total += 1;
  inFlight.byProject.set(projectId, mine + 1);
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    inFlight.total -= 1;
    const left = (inFlight.byProject.get(projectId) ?? 1) - 1;
    if (left > 0) inFlight.byProject.set(projectId, left);
    else inFlight.byProject.delete(projectId);
  };
}

/** Claim the deployment's upload slot, then put the archive in place. Throws 409 when someone got there first. */
function attach(deploymentId: string, partFile: string, meta: UploadMeta): void {
  const side = fileFor(deploymentId, "json");
  const tmp = `${side}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(meta), { mode: 0o600 });
  try {
    // A hard link fails if the name exists, so exactly one upload gets the slot, and it appears whole.
    linkSync(tmp, side);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") {
      throw new HttpError(409, "This deployment already has its build.", "already_received");
    }
    throw e;
  } finally {
    rmSync(tmp, { force: true });
  }
  try {
    renameSync(partFile, fileFor(deploymentId, "tar.gz"));
  } catch (e) {
    rmSync(side, { force: true });
    throw e;
  }
}

/**
 * Take a finished release from GitHub. Returns the deployment it was attached to. Order: find the waiting
 * deployment (before reading the body), stream and hash, compare with the declared checksum, find the
 * deployment again, attach.
 */
export async function acceptUpload(a: UploadOptions): Promise<{ deploymentId: string }> {
  const release = takeUploadSlot(a.projectId, a.maxConcurrent ?? MAX_CONCURRENT_UPLOADS, a.maxPerProject ?? MAX_CONCURRENT_UPLOADS_PER_PROJECT);
  try {
    return await receiveUpload(a);
  } finally {
    release();
  }
}

export type UploadOptions = {
  projectId: string;
  /** What the upload credential was made for. The build is only attached to a deployment of this environment. */
  environment: UploadEnvironment;
  headers: UploadHeaders;
  body: ReadableStream<Uint8Array> | null;
  contentLength: number | null;
  /** Smaller than the 500 MB limit only in tests. */
  maxBytes?: number;
  /** Tests only. Default to UPLOAD_IDLE_MS and UPLOAD_MAX_MS. */
  idleMs?: number;
  maxDurationMs?: number;
  /** Tests only. Default to MAX_CONCURRENT_UPLOADS and MAX_CONCURRENT_UPLOADS_PER_PROJECT. */
  maxConcurrent?: number;
  maxPerProject?: number;
};

async function receiveUpload(a: UploadOptions): Promise<{ deploymentId: string }> {
  const { projectId, headers: h } = a;
  const maxBytes = Math.min(a.maxBytes ?? MAX_ARCHIVE_BYTES, MAX_ARCHIVE_BYTES);
  const db = await getDb();
  const project = await db
    .select({ buildLocation: schema.projects.buildLocation })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get();
  if (!project) throw new HttpError(401, BAD_BUILD_CREDENTIAL, "unauthorized");
  if (project.buildLocation !== "github") {
    throw new HttpError(409, "This project builds on the container, not on GitHub.", "build_location_not_github");
  }
  if (a.contentLength !== null && a.contentLength > maxBytes) {
    throw new HttpError(413, "That archive is too large.", "too_large");
  }

  sweepUploads();

  const env = a.environment;
  const early = await findWaiting(projectId, h.branch, h.commit, env);
  if (!early.waiting) {
    if (!early.received) {
      // A credential for the other environment is a mistake or an attack, and trying again never helps: say so, do not retry.
      const other = await findWaiting(projectId, h.branch, h.commit, env === "production" ? "preview" : "production");
      if (other.waiting || other.received) {
        throw new HttpError(
          403,
          env === "preview"
            ? "This is a production deployment, and the preview upload credential cannot send a build for it. Use the production credential from the egg-production environment."
            : "This is a preview deployment, and the production upload credential cannot send a build for it. Use the preview upload credential.",
          "wrong_upload_credential"
        );
      }
    }
    if (early.received) {
      await eventLog(early.received.id, "warn", `A second build for commit ${h.commit.slice(0, 7)} was rejected: this deployment already has its build.`);
      throw new HttpError(409, "This deployment already has its build.", "already_received");
    }
    throw new HttpError(409, "No deployment is waiting for this commit. Deploy from Egg or push to the branch, then run the workflow again.", "no_deployment_waiting");
  }

  const first = early.waiting.id;
  await eventLog(first, "info", `GitHub is sending the build for commit ${h.commit.slice(0, 7)} (run ${h.run}).`);

  let streamed: Awaited<ReturnType<typeof streamToFile>>;
  try {
    streamed = await streamToFile(a.body, maxBytes, {
      idleMs: a.idleMs ?? UPLOAD_IDLE_MS,
      maxDurationMs: a.maxDurationMs ?? UPLOAD_MAX_MS,
    });
  } catch (err) {
    if (err instanceof HttpError) await eventLog(first, "warn", `The build from GitHub was rejected: ${err.message}`);
    throw err;
  }

  if (streamed.sha256 !== h.sha256) {
    rmSync(streamed.file, { force: true });
    await eventLog(first, "warn", "The build from GitHub was rejected: its checksum did not match the one declared. Run the workflow again.");
    throw new HttpError(400, "The archive does not match the declared SHA-256.", "checksum_mismatch");
  }
  await eventLog(first, "info", `Checksum verified (${(streamed.bytes / 1e6).toFixed(1)} MB).`);

  // The deployment may have been canceled, or finished, while the body was arriving.
  const again = await findWaiting(projectId, h.branch, h.commit, env);
  if (!again.waiting) {
    rmSync(streamed.file, { force: true });
    if (again.received) throw new HttpError(409, "This deployment already has its build.", "already_received");
    await eventLog(first, "warn", "The build from GitHub was rejected: no deployment was waiting for it any more.");
    throw new HttpError(409, "No deployment is waiting for this commit any more.", "no_deployment_waiting");
  }

  const id = again.waiting.id;
  try {
    attach(id, streamed.file, {
      sha256: streamed.sha256,
      commit: h.commit,
      branch: h.branch,
      run: h.run,
      bytes: streamed.bytes,
      receivedAt: Date.now(),
    });
  } catch (err) {
    rmSync(streamed.file, { force: true });
    if (err instanceof HttpError) await eventLog(id, "warn", `A second build for commit ${h.commit.slice(0, 7)} was rejected: ${err.message}`);
    throw err;
  }
  await eventLog(id, "info", `The build for commit ${h.commit.slice(0, 7)} (run ${h.run}) was attached to this deployment.`);
  return { deploymentId: id };
}

// ----------------------------------------------------------------- the worker's side

export type ReceivedUpload = { archivePath: string; meta: UploadMeta };

/** What was attached to the deployment, checked again against the bytes on disk. Null when nothing is there yet. */
export async function readUpload(deploymentId: string): Promise<ReceivedUpload | null> {
  const archivePath = fileFor(deploymentId, "tar.gz");
  const side = fileFor(deploymentId, "json");
  if (!existsSync(archivePath) || !existsSync(side)) return null;
  let meta: UploadMeta;
  try {
    meta = JSON.parse(readFileSync(side, "utf8")) as UploadMeta;
  } catch {
    throw new GithubBuildError("The build GitHub sent could not be read. Run the workflow again.");
  }
  if (statSync(archivePath).size !== meta.bytes || (await sha256File(archivePath)) !== meta.sha256) {
    throw new GithubBuildError("The build GitHub sent did not match its checksum when it was read again. Run the workflow again.");
  }
  return { archivePath, meta };
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(t);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const t = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });

/**
 * Wait for the build to arrive: look every `pollMs`, give up after `timeoutMs`. A cancel (the signal, or the
 * deployment's own state) stops the wait. The upload is verified again before it is returned. On a
 * failure, a stop or a timeout, anything received is removed.
 */
export async function waitForUpload(a: {
  deploymentId: string;
  commit: string | null;
  branch: string;
  timeoutMs?: number;
  pollMs?: number;
  signal?: AbortSignal;
  isCanceled?: () => Promise<boolean>;
  log: { info: (m: string) => void; warn: (m: string) => void };
}): Promise<ReceivedUpload> {
  const timeoutMs = a.timeoutMs ?? UPLOAD_WAIT_MS;
  const pollMs = a.pollMs ?? UPLOAD_POLL_MS;
  const deadline = Date.now() + timeoutMs;
  const minutes = Math.max(1, Math.round(timeoutMs / 60_000));
  a.log.info(
    a.commit
      ? `Waiting for GitHub to send the build for commit ${a.commit.slice(0, 7)} on ${a.branch}, for up to ${minutes} minutes.`
      : `Waiting for GitHub to send the next build for ${a.branch}, for up to ${minutes} minutes.`
  );
  try {
    for (;;) {
      if (a.signal?.aborted || (a.isCanceled && (await a.isCanceled()))) {
        throw new GithubBuildError("The deployment was canceled.");
      }
      const got = await readUpload(a.deploymentId);
      if (got) {
        a.log.info("The build from GitHub arrived and its checksum is still correct.");
        return got;
      }
      const left = deadline - Date.now();
      if (left <= 0) {
        a.log.warn("Timed out waiting for the build from GitHub.");
        throw new GithubBuildError(WAIT_TIMEOUT_MESSAGE);
      }
      await sleep(Math.min(pollMs, left), a.signal);
    }
  } catch (err) {
    discardUpload(a.deploymentId);
    throw err;
  }
}
