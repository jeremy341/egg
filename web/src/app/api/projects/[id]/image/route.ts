import { readJsonLimited } from "@/server/body-limit";
import { authed, handle, ok } from "@/server/http";
import { updateImageSource } from "@/server/registry";

type Ctx = { params: Promise<{ id: string }> };

/** Set the image an image app runs, and the login that pulls it. The deploy step is not built yet. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { id } = await params;
  const body = await readJsonLimited(req, { fallback: {} });
  return ok({ image: await updateImageSource(user.id, id, body) });
});
