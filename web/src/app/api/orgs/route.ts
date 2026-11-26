import { z } from "zod";
import { authed, handle, ok, readJson } from "@/server/http";
import { createOrganization, listOrganizationsFor } from "@/server/organizations";

/** The organizations the signed-in user belongs to, with their role in each. */
export const GET = handle(async () => {
  const user = await authed();
  return ok({ organizations: await listOrganizationsFor(user.id) });
});

/** Create an organization. The creator becomes its owner. */
export const POST = handle(async (req) => {
  const user = await authed();
  const body = await readJson(req, z.object({ name: z.string().max(200) }));
  return ok(await createOrganization(user.id, body.name), 201);
});
