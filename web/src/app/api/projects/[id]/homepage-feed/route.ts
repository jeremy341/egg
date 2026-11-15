import { authed, handle, ok } from "@/server/http";
import { setHomepageFeed } from "@/server/public-feed";

type Ctx = { params: Promise<{ id: string }> };

/** Show the project's deployments on the Egg homepage. Owner only; the repository must be public. */
export const POST = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id } = await params;
  return ok(await setHomepageFeed(user.id, id, true));
});

/** Stop showing them. */
export const DELETE = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id } = await params;
  return ok(await setHomepageFeed(user.id, id, false));
});
