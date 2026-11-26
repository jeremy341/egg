import { authed, handle, ok } from "@/server/http";
import { getAccessSettings } from "@/server/access-protection";

type Ctx = { params: Promise<{ id: string }> };

/** Owners can check the protection state without receiving any credential material. */
export const GET = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id } = await params;
  const settings = await getAccessSettings(user.id, id);
  return ok({ enabled: settings.mode !== "open", mode: settings.mode });
});
