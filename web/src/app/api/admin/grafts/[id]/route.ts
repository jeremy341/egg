import { z } from "zod";
import { authed, handle, ok, readJson } from "@/server/http";
import { isGraftId, requireGraftAdmin, setGraftEnabled } from "@/server/grafts/registry";
import { notFound } from "@/server/http";

const patchInput = z.object({ enabled: z.boolean() }).strict();
type Context = { params: Promise<{ id: string }> };

export const PATCH = handle<Context>(async (req, { params }) => {
  const user = await authed();
  await requireGraftAdmin(user.id);
  const { id } = await params;
  if (!isGraftId(id)) throw notFound("Unknown Egg app.");
  return ok({ graft: await setGraftEnabled(user.id, id, (await readJson(req, patchInput)).enabled) });
});
