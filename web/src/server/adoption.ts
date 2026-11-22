import { z } from "zod";
import { config } from "@/server/config";
import { isValidSlug, serverDiscriminator, unitName } from "@/server/deploy/layout";
import { HttpError } from "@/server/http";
import { getServerForUser, withServerSession } from "@/server/servers";
import { SshError, type NestSession } from "@/server/ssh/connection";
import {
  AdoptionParseError,
  adoptionScript,
  parseAdoption,
  type AdoptionRaw,
} from "@/server/ssh/adoption-probe";

/**
 * What already lives on a container where a project is about to go, and
 * whether it is in the way. Everything here only reads: nothing is stopped,
 * moved or deleted, and the answer never includes command lines, environment
 * or file contents.
 *
 * Marker rule: a service or folder is Egg's only when it carries our
 * marker (see deploy/layout.ts). Without one it is the user's, and a deploy
 * refuses rather than overwrite it.
 */

export type ConflictKind = "unit" | "folder" | "port" | "process" | "checkout";

export type Conflict = {
  kind: ConflictKind;
  /** A service name, a home-relative path, "port 3000" or "node (pid 123)". */
  name: string;
  /** A plain sentence for the person deploying. */
  detail: string;
  /** True when a deploy must not go ahead until this is dealt with. */
  blocking: boolean;
  /** True when Egg created it (so it may be reused). */
  managedByEgg: boolean;
};

/** A conflict plus when it blocks: always, or only for the first production deploy. */
export type DetectedConflict = Conflict & { scope: "always" | "firstDeploy" };

export type ConflictContext = {
  slug: string;
  unit: string;
  port: number;
  repo: string | null;
};

const RUNNING = new Set(["active", "activating", "reloading"]);

/** Pure: turn what the probe saw into conflicts. */
export function detectConflicts(raw: AdoptionRaw, ctx: ConflictContext): DetectedConflict[] {
  const out: DetectedConflict[] = [];
  const add = (c: Omit<DetectedConflict, "scope"> & { scope?: DetectedConflict["scope"] }) =>
    out.push({ scope: "always", ...c });
  const repo = ctx.repo ?? "this repository";
  const dir = `~/.egg/${ctx.slug}`;

  const cg = raw.own.controlGroup;
  const isOwn = (pid: number | null, cgroups: string[]) =>
    (pid !== null && raw.own.pid !== null && pid === raw.own.pid) ||
    cgroups.some(
      (g) => (cg && cg !== "/" && (g === cg || g.startsWith(`${cg}/`))) || g.endsWith(`/${ctx.unit}`) || g.includes(`/${ctx.unit}/`)
    );

  // ---- the service name
  if (raw.unitFile && !raw.unitFile.managed) {
    add({
      kind: "unit",
      name: ctx.unit,
      detail: `A service called ${ctx.unit} already exists and Egg did not create it. It will not be replaced. Choose another project name.`,
      blocking: true,
      managedByEgg: false,
    });
  } else if (!raw.unitFile && raw.own.loaded) {
    add({
      kind: "unit",
      name: ctx.unit,
      detail: `systemd already has a service called ${ctx.unit} that Egg did not create. Choose another project name.`,
      blocking: true,
      managedByEgg: false,
    });
  } else if (raw.unitFile) {
    add({
      kind: "unit",
      name: ctx.unit,
      detail: "Left by an earlier Egg project with this name. A deploy will update it.",
      blocking: false,
      managedByEgg: true,
    });
  }

  // ---- the project folder
  const f = raw.folder;
  if (f?.kind === "link") {
    add({
      kind: "folder",
      name: dir,
      detail: `${dir} is a link. Egg will not write through it. Remove the link or choose another project name.`,
      blocking: true,
      managedByEgg: false,
    });
  } else if (f?.kind === "file") {
    add({
      kind: "folder",
      name: dir,
      detail: `${dir} is a file, not a folder. Choose another project name.`,
      blocking: true,
      managedByEgg: false,
    });
  } else if (f?.kind === "dir") {
    if (f.managed) {
      add({
        kind: "folder",
        name: dir,
        detail: "Left by an earlier Egg project with this name. It will be reused.",
        blocking: false,
        managedByEgg: true,
      });
    } else if (f.git) {
      add({
        kind: "checkout",
        name: dir,
        detail: `${dir} is a git checkout that is not Egg's. It will not be touched or deleted. Choose another project name.`,
        blocking: true,
        managedByEgg: false,
      });
    } else if (f.entries > 0) {
      add({
        kind: "folder",
        name: dir,
        detail: `${dir} already holds files that Egg did not create. They will not be touched. Choose another project name.`,
        blocking: true,
        managedByEgg: false,
      });
    }
  }

  // ---- the port
  const holders = raw.ports.filter((p) => p.port === ctx.port);
  if (raw.portsSource === "none") {
    add({
      kind: "port",
      name: `port ${ctx.port}`,
      detail: `Egg could not read the listening ports on this container, so it could not check that port ${ctx.port} is free.`,
      blocking: false,
      managedByEgg: false,
    });
  } else if (holders.length > 0) {
    // ss can fail to attribute a pid to the listener on our own port even when it can name
    // listeners on unrelated ports. Scope the fallback to this port's holders only, so a
    // named listener elsewhere does not turn our own Egg holder into a foreign conflict.
    const haveNames = holders.some((p) => p.pid !== null);
    const ownUp = raw.unitFile?.active === "active";
    const foreign = holders.filter((h) => !(isOwn(h.pid, h.cgroups) || (!haveNames && ownUp)));
    if (foreign.length > 0) {
      const who = foreign[0].process ? ` by ${foreign[0].process}` : "";
      add({
        kind: "port",
        name: `port ${ctx.port}`,
        detail: `Port ${ctx.port} is already in use${who}. Egg will not stop it. Choose another port, or stop that program yourself first.`,
        blocking: true,
        managedByEgg: false,
      });
    }
  }

  // ---- the same repository already running by hand
  for (const p of raw.processes) {
    if (isOwn(p.pid, p.cgroups)) continue;
    const name = `${p.comm} (pid ${p.pid})`;
    if (p.inTarget) {
      add({
        kind: "process",
        name,
        detail: `${p.comm} is running from ${dir} but Egg did not start it. Stop it first, or choose another project name.`,
        blocking: true,
        managedByEgg: false,
      });
    } else if (p.sameRepo) {
      add({
        kind: "process",
        name,
        detail: `${p.comm} is already running from ~/${p.cwd}, a checkout of ${repo}. Deploying would start a second copy. Stop it yourself first if you want Egg to take over.`,
        blocking: true,
        scope: "firstDeploy",
        managedByEgg: false,
      });
    }
  }
  for (const u of raw.units) {
    const running = RUNNING.has(u.active);
    if (u.inTarget) {
      add({
        kind: "unit",
        name: u.name,
        detail: `${u.name} runs from ${dir} but Egg did not create it. ${running ? "It is running. Stop it first, or choose another project name." : "It is stopped, so nothing is in the way for now."}`,
        blocking: running,
        managedByEgg: false,
      });
    } else if (u.sameRepo) {
      add({
        kind: "unit",
        name: u.name,
        detail: running
          ? `${u.name} is already running ~/${u.cwd}, a checkout of ${repo}. Deploying would start a second copy. Stop it yourself first if you want Egg to take over.`
          : `${u.name} is set up to run ~/${u.cwd}, a checkout of ${repo}, but is stopped. Starting it later would run a second copy.`,
        blocking: running,
        scope: running ? "firstDeploy" : "always",
        managedByEgg: false,
      });
    }
  }

  // ---- checkouts that are only there, not running
  for (const c of raw.checkouts.slice(0, 5)) {
    add({
      kind: "checkout",
      name: `~/${c}`,
      detail: `You already have a checkout of ${repo} here. Egg builds elsewhere and deploys into ${dir}, so this folder is not touched.`,
      blocking: false,
      managedByEgg: false,
    });
  }
  return out;
}

/** What stops this deploy. Conflicts that only matter for a first production deploy are dropped otherwise. */
export function blockingConflicts(found: DetectedConflict[], firstProductionDeploy: boolean): Conflict[] {
  return found
    .filter((c) => c.blocking && (c.scope === "always" || firstProductionDeploy))
    .map(strip);
}

function strip(c: DetectedConflict): Conflict {
  return {
    kind: c.kind,
    name: c.name,
    detail: c.detail,
    blocking: c.blocking,
    managedByEgg: c.managedByEgg,
  };
}

/** owner/repo from a GitHub URL or "owner/repo" text, or null. */
export function repoNameOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /^(?:https?:\/\/github\.com\/|git@github\.com:)?([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(
    value.trim()
  );
  return m ? `${m[1]}/${m[2]}` : null;
}

/** Run the read-only probe on an open session and detect conflicts. */
export async function probeConflicts(
  session: NestSession,
  args: { unitDir: string; slug: string; unit: string; port: number; repo: string | null }
): Promise<DetectedConflict[]> {
  const res = await session.script(adoptionScript(args), { timeoutMs: 60_000 });
  return detectConflicts(parseAdoption(res.stdout), args);
}

export const conflictsInput = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .refine(isValidSlug, "Use lowercase letters, digits and hyphens"),
  port: z.number().int().min(1).max(65535),
  repoFullName: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}$/, "Use the form owner/repo")
    .nullable()
    .optional(),
});

export type ConflictsInput = z.infer<typeof conflictsInput>;

function upstream(err: unknown): never {
  if (err instanceof SshError) {
    throw new HttpError(err.kind === "timeout" ? 504 : 502, err.message.replace(/\.$/, ""), "upstream");
  }
  if (err instanceof AdoptionParseError) {
    throw new HttpError(502, err.message.replace(/\.$/, ""), "upstream");
  }
  throw err;
}

/**
 * Look at the user's container for anything that would be in the way of a new
 * project. The server must belong to the user (404 otherwise); nothing on the
 * container is changed.
 */
export async function checkProjectConflicts(
  userId: string,
  serverId: string,
  raw: unknown
): Promise<Conflict[]> {
  const input = conflictsInput.parse(raw);
  const server = await getServerForUser(userId, serverId);
  try {
    const found = await withServerSession(server, (s) =>
      probeConflicts(s, {
        unitDir: config().UNIT_DIR,
        slug: input.slug,
        unit: unitName(input.slug, undefined, serverDiscriminator(server.id)),
        port: input.port,
        repo: input.repoFullName ?? null,
      })
    );
    return found.map(strip);
  } catch (err) {
    upstream(err);
  }
}
