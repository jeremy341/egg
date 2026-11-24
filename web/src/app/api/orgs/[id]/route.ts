import { z } from "zod";
import { authed, handle, ok, readJson } from "@/server/http";
import { getOrganizationFor, updateOrganizationName } from "@/server/organizations";

type Ctx = { params: Promise<{ id: string }> };

/** One organization. Any member; non-members get 404. */
export const GET = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id } = await params;
  return ok({ organization: await getOrganizationFor(user.id, id) });
});

/** Rename. Owners and admins. */
export const PATCH = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { id } = await params;
  const body = await readJson(req, z.object({ name: z.string().max(200) }));
  await updateOrganizationName(user.id, id, body.name);
  return ok({ organization: await getOrganizationFor(user.id, id) });
});
