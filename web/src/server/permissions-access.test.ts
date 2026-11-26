import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "@/server/db";
import { useFreshDb } from "@/server/test/db";
import {
  assertProjectAccess,
  canAdminProject,
  canEditProject,
  canViewProject,
  projectAccess,
  resolveProjectAccess,
  type ProjectAccessInput,
} from "@/server/permissions";

/**
 * Expected access, written out by hand from the rules in permissions.ts rather
 * than computed by the same code. Columns are project roles (none, admin,
 * member, viewer); rows are organization roles.
 *   A = view, edit and admin   E = view and edit   V = view only   - = nothing
 */
const ORG_TABLE: Record<string, [string, string, string, string]> = {
  owner: ["A", "A", "A", "A"],
  admin: ["A", "A", "A", "A"],
  member: ["-", "A", "E", "V"],
  guest: ["-", "A", "E", "V"],
  none: ["-", "-", "-", "-"],
};
const PERSONAL_TABLE: [string, string, string, string] = ["-", "A", "E", "V"];
const PROJECT_ROLES = [null, "admin", "member", "viewer"] as const;
const CODE: Record<string, { view: boolean; edit: boolean; admin: boolean }> = {
  A: { view: true, edit: true, admin: true },
  E: { view: true, edit: true, admin: false },
  V: { view: true, edit: false, admin: false },
  "-": { view: false, edit: false, admin: false },
};

describe("projectAccess: every role combination", () => {
  it("gives the project owner everything, with or without an organization", () => {
    for (const hasOrg of [true, false]) {
      for (const orgRole of hasOrg ? (["owner", "admin", "member", "guest", null] as const) : ([null] as const)) {
        for (const projectRole of PROJECT_ROLES) {
          const access = projectAccess({ isOwner: true, hasOrg, orgRole, projectRole });
          expect(access).toEqual(CODE.A);
        }
      }
    }
  });

  it.each(
    Object.entries(ORG_TABLE).flatMap(([orgRole, row]) =>
      PROJECT_ROLES.map((projectRole, col) => [orgRole, projectRole, row[col]] as const)
    )
  )("organization role %s with project role %s, in an org project, is %s", (orgRole, projectRole, code) => {
    const access = projectAccess({
      isOwner: false,
      hasOrg: true,
      orgRole: orgRole === "none" ? null : (orgRole as "owner"),
      projectRole,
    });
    expect(access).toEqual(CODE[code]);
  });

  it.each(PROJECT_ROLES.map((projectRole, col) => [projectRole, PERSONAL_TABLE[col]] as const))(
    "personal project, project role %s, is %s",
    (projectRole, code) => {
      expect(projectAccess({ isOwner: false, hasOrg: false, orgRole: null, projectRole })).toEqual(CODE[code]);
    }
  );

  it("never lets an organization role without a project role edit a member's project", () => {
    for (const orgRole of ["member", "guest"] as const) {
      expect(projectAccess({ isOwner: false, hasOrg: true, orgRole, projectRole: null })).toEqual(CODE["-"]);
    }
  });

  it("is monotonic over all 48 combinations: admin implies edit implies view", () => {
    const inputs: ProjectAccessInput[] = [];
    for (const isOwner of [true, false]) {
      for (const projectRole of PROJECT_ROLES) {
        inputs.push({ isOwner, hasOrg: false, orgRole: null, projectRole });
        for (const orgRole of ["owner", "admin", "member", "guest", null] as const) {
          inputs.push({ isOwner, hasOrg: true, orgRole, projectRole });
        }
      }
    }
    expect(inputs).toHaveLength(48);
    for (const input of inputs) {
      const access = projectAccess(input);
      if (canAdminProject(access)) expect(canEditProject(access)).toBe(true);
      if (canEditProject(access)) expect(canViewProject(access)).toBe(true);
    }
  });
});

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
const now = new Date("2026-11-01T00:00:00Z");

beforeAll(async () => {
  ctx = await useFreshDb();
  const users = ["owner", "orgAdmin", "member", "removed", "viewer", "stranger"];
  await ctx.db.insert(schema.users).values(users.map((id) => ({ id, hackClubId: id, name: id, email: `${id}@example.com`, createdAt: now })));
  await ctx.db.insert(schema.servers).values({ id: "s", userId: "owner", nestUsername: "owner", host: "host", publicKey: "key", privateKeyEnc: "sealed", keyFingerprint: "fp", createdAt: now });
  await ctx.db.insert(schema.organizations).values({ id: "org", name: "Org", slug: "org", ownerId: "owner", createdAt: now, updatedAt: now });
  await ctx.db.insert(schema.orgMembers).values([
    { orgId: "org", userId: "owner", role: "owner", createdAt: now },
    { orgId: "org", userId: "orgAdmin", role: "admin", createdAt: now },
    { orgId: "org", userId: "member", role: "member", createdAt: now },
    { orgId: "org", userId: "viewer", role: "guest", createdAt: now },
  ]);
  const base = { serverId: "s", repoUrl: "https://github.com/a/b", runtime: "node" as const, port: 3000, createdAt: now, updatedAt: now };
  await ctx.db.insert(schema.projects).values([
    { ...base, id: "orgProject", userId: "owner", slug: "org-project", name: "Org project", orgId: "org" },
    { ...base, id: "personal", userId: "owner", slug: "personal", name: "Personal", orgId: null },
  ]);
  await ctx.db.insert(schema.projectMembers).values([
    { projectId: "orgProject", userId: "member", role: "member", createdAt: now },
    { projectId: "orgProject", userId: "viewer", role: "viewer", createdAt: now },
    { projectId: "orgProject", userId: "removed", role: "admin", createdAt: now },
    { projectId: "personal", userId: "viewer", role: "viewer", createdAt: now },
  ]);
});
afterAll(async () => ctx.cleanup());

describe("resolveProjectAccess against the database", () => {
  it("org owner and admin see and manage every org project without a project row", async () => {
    expect(await resolveProjectAccess("owner", "orgProject")).toEqual(CODE.A);
    expect(await resolveProjectAccess("orgAdmin", "orgProject")).toEqual(CODE.A);
  });

  it("an org member with a project role gets exactly that role", async () => {
    expect(await resolveProjectAccess("member", "orgProject")).toEqual(CODE.E);
    expect(await resolveProjectAccess("viewer", "orgProject")).toEqual(CODE.V);
  });

  it("a project role does not survive removal from the organization", async () => {
    // "removed" holds an admin project row but is not in the org.
    expect(await resolveProjectAccess("removed", "orgProject")).toEqual(CODE["-"]);
  });

  it("a personal project honours a project role directly", async () => {
    expect(await resolveProjectAccess("viewer", "personal")).toEqual(CODE.V);
  });

  it("an unknown project and a stranger get nothing", async () => {
    expect(await resolveProjectAccess("stranger", "orgProject")).toEqual(CODE["-"]);
    expect(await resolveProjectAccess("owner", "missing")).toEqual(CODE["-"]);
  });

  it("assertProjectAccess answers 404 for no view and 403 for a missing level", async () => {
    await expect(assertProjectAccess("stranger", "orgProject", "view")).rejects.toMatchObject({ status: 404 });
    await expect(assertProjectAccess("viewer", "orgProject", "edit")).rejects.toMatchObject({ status: 403 });
    await expect(assertProjectAccess("member", "orgProject", "edit")).resolves.toEqual(CODE.E);
    await expect(assertProjectAccess("member", "orgProject", "admin")).rejects.toMatchObject({ status: 403 });
  });
});
