import { authed, handle, ok } from "@/server/http";
import { dismissAnnouncement } from "@/server/grafts/announcements";
import { requireGraftEnabled } from "@/server/grafts/registry";

type Context = { params: Promise<{ id: string }> };

export const POST = handle<Context>(async (_req, { params }) => {
  const user = await authed();
  await requireGraftEnabled("announcements");
  const { id } = await params;
  await dismissAnnouncement(user.id, id);
  return ok({ dismissed: true });
});
