import { readJsonLimited } from "@/server/body-limit";
import { authed, handle, ok } from "@/server/http";
import { createRegistryCredential, listRegistryCredentials } from "@/server/registry";

/** Registry logins. The password is accepted on create and never returned. */
export const GET = handle(async () => {
  const user = await authed();
  return ok({ logins: await listRegistryCredentials(user.id) });
});

export const POST = handle(async (req) => {
  const user = await authed();
  const body = await readJsonLimited(req, { fallback: {} });
  return ok({ login: await createRegistryCredential(user.id, body) }, 201);
});
