import { authed, handle, ok, readJson } from "@/server/http";
import { disableAnalytics, enableAnalytics } from "@/server/analytics";
import { featuresPatch, updateFeatures } from "@/server/analytics-config";

type Ctx = { params: Promise<{ id: string }> };

/** Turn analytics on and return the snippet to paste into the site. */
export const POST = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id } = await params;
  return ok(await enableAnalytics(user.id, id));
});

export const DELETE = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id } = await params;
  await disableAnalytics(user.id, id);
  return ok({ ok: true });
});

/** Switch the opt-in features on or off, or change the funnel steps. */
export const PATCH = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { id } = await params;
  const patch = await readJson(req, featuresPatch);
  return ok({ features: await updateFeatures(user.id, id, patch) });
});
