import { z } from "zod";
import { readJsonLimited } from "@/server/body-limit";
import { authed, handle, ok } from "@/server/http";
import { deleteSharedEnv, listSharedEnv, setSharedEnv } from "@/server/shared-env";

type Ctx = { params: Promise<{ id: string }> };
const environment = z.enum(["all", "production", "preview"]);
const setInput = z.object({
  environment,
  key: z.string(),
  value: z.string(),
});

export const GET = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { id } = await params;
  const parsed = environment.safeParse(new URL(req.url).searchParams.get("environment"));
  if (!parsed.success) return ok({ error: "Environment must be all, production, or preview." }, 400);
  return ok({ env: await listSharedEnv(user.id, id, parsed.data) });
});

export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { id } = await params;
  const input = setInput.parse(await readJsonLimited(req, { fallback: {} }));
  await setSharedEnv(user.id, id, input.environment, input.key, input.value);
  return ok({ ok: true }, 201);
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { id } = await params;
  const url = new URL(req.url);
  const parsed = z.object({ environment, key: z.string().min(1) }).safeParse({
    environment: url.searchParams.get("environment"),
    key: url.searchParams.get("key"),
  });
  if (!parsed.success) return ok({ error: "Environment and key are required." }, 400);
  await deleteSharedEnv(user.id, id, parsed.data.environment, parsed.data.key);
  return ok({ ok: true });
});
