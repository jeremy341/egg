import { readJsonLimited } from "@/server/body-limit";
import { authed, handle, ok } from "@/server/http";
import { removeRegistryCredential, updateRegistryCredential } from "@/server/registry";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { id } = await params;
  const body = await readJsonLimited(req, { fallback: {} });
  return ok({ login: await updateRegistryCredential(user.id, id, body) });
});

/** Refused while an app still uses the login; the refusal names those apps. */
export const DELETE = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id } = await params;
  await removeRegistryCredential(user.id, id);
  return ok({ ok: true });
});
