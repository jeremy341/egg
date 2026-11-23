import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { newId, seal } from "@/server/crypto";
import { isUniqueViolation } from "@/server/db/errors";
import { getDb, schema } from "@/server/db";
import { GithubError, headers, installationToken } from "@/server/github/app";
import { HttpError, notFound } from "@/server/http";
import { getProjectForUser, type ProjectRow } from "@/server/projects";
import { generateServerKey } from "@/server/ssh/keys";

/**
 * SSH keys Egg generates for you, beyond the per-server key that lives on the
 * servers row. Three kinds, all ed25519:
 *
 * - "github_deploy": one per project, added to the linked GitHub repository
 *   through the GitHub App, read-only, removed there again on revoke.
 * - "git_key": one per project, for the repository of your own git host; you
 *   paste the public key there yourself.
 * - "personal": for your own use outside Egg; the private key is shown once
 *   when it is created and can only be downloaded then.
 *
 * Private halves are sealed for their own key row and replaced with a seal of
 * "removed" once the key is revoked, so nothing left on disk can be used later.
 */

const MAX_ACTIVE_PERSONAL_KEYS = 20;
const KEY_CONTEXT = (id: string) => `sshkey:${id}`;

type FetchLike = typeof fetch;

export const createPersonalKeyInput = z.object({
  name: z.string().trim().min(1, "Give the key a name.").max(60),
});

export const createProjectKeyInput = z.object({
  kind: z.enum(["github_deploy", "git_key"]),
  /** Only git keys carry a name; deploy keys are named after the project. */
  name: z
    .string()
    .trim()
    .min(1, "Give the key a name.")
    .max(60)
    .refine((v) => !/[\r\n\u0000]/.test(v), "Keep the name to one line.")
    .optional(),
});

export const rotateProjectKeyInput = z.object({ kind: createProjectKeyInput.shape.kind });

export type KeyRow = typeof schema.sshKeys.$inferSelect;

export type KeySummary = {
  id: string;
  kind: "github_deploy" | "git_key" | "personal";
  name: string;
  fingerprint: string;
  /** One line, ready to paste wherever the key is installed. */
  publicKey: string;
  /** True once GitHub confirmed the deploy key on its repository. */
  installed: boolean;
  createdAt: string;
  revokedAt: string | null;
  projectId: string | null;
  projectName: string | null;
  projectSlug: string | null;
};

type ProjectLabel = { name: string | null; slug: string | null } | null;

export function summarizeKey(row: KeyRow, project: ProjectLabel = null): KeySummary {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    fingerprint: row.fingerprint,
    publicKey: row.publicKey,
    installed: row.kind === "github_deploy" && row.externalId !== null,
    createdAt: row.createdAt.toISOString(),
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    projectId: row.projectId,
    projectName: project?.name ?? null,
    projectSlug: project?.slug ?? null,
  };
}

/** Every key of the user, newest first. Revoked ones are included, with revokedAt set. */
export async function listKeysForUser(userId: string) {
  const db = await getDb();
  const rows = await db
    .select({
      key: schema.sshKeys,
      projectName: schema.projects.name,
      projectSlug: schema.projects.slug,
    })
    .from(schema.sshKeys)
    .leftJoin(schema.projects, eq(schema.projects.id, schema.sshKeys.projectId))
    .where(eq(schema.sshKeys.userId, userId))
    .orderBy(desc(schema.sshKeys.createdAt));
  return rows.map((r) => summarizeKey(r.key, { name: r.projectName, slug: r.projectSlug }));
}

/** One active-key slot per project and kind is enforced by the partial unique index. */
async function findActiveProjectKey(projectId: string, kind: "github_deploy" | "git_key") {
  const db = await getDb();
  return db
    .select()
    .from(schema.sshKeys)
    .where(
      and(
        eq(schema.sshKeys.projectId, projectId),
        eq(schema.sshKeys.kind, kind),
        isNull(schema.sshKeys.revokedAt)
      )
    )
    .get();
}

/** A generated pair, in the same sealed row shape every kind stores. */
function newKeyValues(
  userId: string,
  kind: "github_deploy" | "git_key" | "personal",
  name: string,
  projectId: string | null
) {
  const id = newId();
  const key = generateServerKey(`egg:${kind === "personal" ? "personal" : "repo"} ${name}`);
  return {
    row: {
      id,
      userId,
      projectId,
      kind,
      name,
      publicKey: key.publicKey,
      privateKeyEnc: seal(key.privateKey, KEY_CONTEXT(id)),
      fingerprint: key.fingerprint,
      externalId: null as string | null,
      createdAt: new Date(),
      revokedAt: null,
    },
    privateKey: key.privateKey,
  };
}

/** Add a deploy key to the linked repo, through the GitHub App installation. */
async function addGithubDeployKey(project: ProjectRow, publicKey: string, fetcher: FetchLike): Promise<string> {
  if (!project.installationId || !project.repoFullName) {
    throw new HttpError(409, "Link the project's GitHub repository first.", "repository_required");
  }
  let token: string;
  try {
    token = await installationToken(project.installationId);
  } catch (err) {
    throw new HttpError(502, err instanceof GithubError ? err.message : "GitHub is not reachable right now.", "upstream");
  }
  let res: Response;
  try {
    res = await fetcher(`https://api.github.com/repos/${project.repoFullName}/keys`, {
      method: "POST",
      headers: headers(token, { "content-type": "application/json" }),
      body: JSON.stringify({ title: `egg ${project.name}`, key: publicKey, read_only: true }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    throw new HttpError(502, "GitHub could not be reached while adding the key.", "upstream");
  }
  if (res.status === 201) {
    const data = (await res.json().catch(() => null)) as { id?: unknown } | null;
    if (typeof data?.id === "number" && Number.isSafeInteger(data.id)) return String(data.id);
    throw new HttpError(502, "GitHub accepted the key but did not return its id. Remove it there and try again.", "upstream");
  }
  if (res.status === 403 || res.status === 404) {
    throw new HttpError(
      502,
      'GitHub refused the key. The GitHub App needs the "Deployments" write permission for this repository.',
      "upstream"
    );
  }
  if (res.status === 422) {
    throw new HttpError(409, "GitHub already knows a deploy key with this public key. Remove the old one there first.", "conflict");
  }
  throw new HttpError(502, `GitHub rejected the key (${res.status}).`, "upstream");
}

/** Remove a deploy key from GitHub. 404 means it is already gone, which is what we want. */
async function removeGithubDeployKey(project: ProjectRow, externalId: string, fetcher: FetchLike): Promise<void> {
  if (!project.installationId || !project.repoFullName) return;
  let token: string;
  try {
    token = await installationToken(project.installationId);
  } catch (err) {
    throw new HttpError(502, err instanceof GithubError ? err.message : "GitHub is not reachable right now.", "upstream");
  }
  let res: Response;
  try {
    res = await fetcher(`https://api.github.com/repos/${project.repoFullName}/keys/${externalId}`, {
      method: "DELETE",
      headers: headers(token),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    throw new HttpError(502, "GitHub could not be reached while removing the key.", "upstream");
  }
  if (!res.ok && res.status !== 404) {
    throw new HttpError(502, `GitHub could not remove the key (${res.status}). Try again in a moment.`, "upstream");
  }
}

/** What a revoked row keeps: no private material, no handle into GitHub. */
function revokedRowUpdate(id: string, now: Date) {
  return { revokedAt: now, privateKeyEnc: seal("removed", KEY_CONTEXT(id)), externalId: null };
}

/**
 * Revoke any of the user's keys. A deploy key still installed on GitHub is
 * removed there first: refusing is safer than a local "revoked" key that
 * still opens the repository.
 */
export async function revokeKey(userId: string, keyId: string, now = new Date(), fetcher: FetchLike = fetch) {
  const db = await getDb();
  const row = await db
    .select()
    .from(schema.sshKeys)
    .where(and(eq(schema.sshKeys.id, keyId), eq(schema.sshKeys.userId, userId), isNull(schema.sshKeys.revokedAt)))
    .get();
  if (!row) throw notFound("Key not found");

  let project: ProjectRow | null = null;
  if (row.projectId) project = await getProjectForUser(userId, row.projectId);

  if (row.kind === "github_deploy" && row.externalId && project?.installationId && project?.repoFullName) {
    await removeGithubDeployKey(project, row.externalId, fetcher);
  }

  await db.update(schema.sshKeys).set(revokedRowUpdate(keyId, now)).where(eq(schema.sshKeys.id, keyId));
  await audit(userId, "key.revoke", keyId, { kind: row.kind, name: row.name });
  return { revoked: true as const };
}

/** A vault key for your own use. The private key is returned once and never shown again. */
export async function createPersonalKey(userId: string, raw: unknown, now = new Date()) {
  const input = createPersonalKeyInput.parse(raw);
  const db = await getDb();
  // The count and the insert share one transaction, so two keys created together
  // cannot both slip past the cap.
  const { row, privateKey } = newKeyValues(userId, "personal", input.name, null);
  await db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: schema.sshKeys.id })
      .from(schema.sshKeys)
      .where(and(eq(schema.sshKeys.userId, userId), eq(schema.sshKeys.kind, "personal"), isNull(schema.sshKeys.revokedAt)));
    if (existing.length >= MAX_ACTIVE_PERSONAL_KEYS) {
      throw new HttpError(400, `You can have up to ${MAX_ACTIVE_PERSONAL_KEYS} active keys. Revoke one first.`, "limit");
    }
    await tx.insert(schema.sshKeys).values(row);
  });
  await audit(userId, "key.create", row.id, { kind: "personal", name: input.name });
  return { key: summarizeKey(row), privateKey };
}

/** A key owned by a project: auto-installed on GitHub, or pasted by you on your own git host. */
export async function createProjectKey(
  userId: string,
  projectId: string,
  raw: unknown,
  now = new Date(),
  fetcher: FetchLike = fetch
) {
  const input = createProjectKeyInput.parse(raw);
  const project = await getProjectForUser(userId, projectId);
  if (input.kind === "github_deploy" && project.sourceProvider !== "github") {
    throw new HttpError(400, "Deploy keys are for GitHub projects. For your own git host, use a git key.", "validation");
  }
  if (input.kind === "git_key" && project.sourceProvider === "github") {
    throw new HttpError(400, "GitHub projects use a deploy key; git keys are for your own git host.", "validation");
  }
  const name =
    input.kind === "github_deploy"
      ? `${project.name} deploy key`
      : input.name ?? "git key";
  const { row, privateKey } = newKeyValues(userId, input.kind, name, projectId);
  if (input.kind === "github_deploy") {
    row.externalId = await addGithubDeployKey(project, row.publicKey, fetcher);
  }
  try {
    const db = await getDb();
    await db.insert(schema.sshKeys).values(row);
  } catch (err) {
    // The unique slot was taken while GitHub was adding our key; remove the
    // fresh key there again so nothing lingers untracked.
    if (input.kind === "github_deploy" && row.externalId) {
      await removeGithubDeployKey(project, row.externalId, fetcher).catch(() => null);
    }
    if (isUniqueViolation(err)) {
      throw new HttpError(409, "This project already has an active key of this kind. Revoke it first.", "conflict");
    }
    throw err;
  }
  await audit(userId, "key.create", row.id, { kind: input.kind, project: project.slug, repo: project.repoFullName ?? null });
  // The private half of a git key is handed out once, like a personal key; a
  // deploy key stays sealed inside Egg alone.
  return { key: summarizeKey(row), privateKey: input.kind === "git_key" ? privateKey : null };
}

/**
 * Replace the project's active key of this kind with a fresh one. The new key is
 * installed on GitHub before the old one is revoked locally, so the repository
 * never loses access between the two steps; if installing the new key fails,
 * the old one is left untouched.
 */
export async function rotateProjectKey(
  userId: string,
  projectId: string,
  raw: unknown,
  now = new Date(),
  fetcher: FetchLike = fetch
) {
  const input = rotateProjectKeyInput.parse(raw);
  const project = await getProjectForUser(userId, projectId);
  if (input.kind === "github_deploy" && project.sourceProvider !== "github") {
    throw new HttpError(400, "Deploy keys are for GitHub projects. For your own git host, use a git key.", "validation");
  }
  if (input.kind === "git_key" && project.sourceProvider === "github") {
    throw new HttpError(400, "GitHub projects use a deploy key; git keys are for your own git host.", "validation");
  }
  const old = await findActiveProjectKey(projectId, input.kind);
  const name = old?.name ?? (input.kind === "github_deploy" ? `${project.name} deploy key` : "git key");
  const { row, privateKey } = newKeyValues(userId, input.kind, name, projectId);

  // Install the new key on GitHub first; if the local swap fails after this,
  // remove it again there so nothing lingers untracked.
  if (input.kind === "github_deploy") {
    row.externalId = await addGithubDeployKey(project, row.publicKey, fetcher);
  }

  const db = await getDb();
  try {
    await db.transaction(async (tx) => {
      if (old) await tx.update(schema.sshKeys).set(revokedRowUpdate(old.id, now)).where(eq(schema.sshKeys.id, old.id));
      await tx.insert(schema.sshKeys).values(row);
    });
  } catch (err) {
    if (input.kind === "github_deploy" && row.externalId) {
      await removeGithubDeployKey(project, row.externalId, fetcher).catch(() => null);
    }
    if (isUniqueViolation(err)) {
      throw new HttpError(409, "This project already has an active key of this kind. Revoke it first.", "conflict");
    }
    throw err;
  }

  // The swap already succeeded locally; the old key on GitHub is dead weight and
  // its removal is reported, never a reason to undo the rotation.
  let removedOld = true;
  if (old && input.kind === "github_deploy" && old.externalId) {
    try {
      await removeGithubDeployKey(project, old.externalId, fetcher);
    } catch {
      removedOld = false;
    }
  }
  await audit(userId, "key.rotate", row.id, {
    kind: input.kind,
    project: project.slug,
    removedRemote: input.kind === "github_deploy" ? removedOld : null,
  });
  return {
    key: summarizeKey(row),
    privateKey: input.kind === "git_key" ? privateKey : null,
    removedFromGithub: removedOld,
  };
}
