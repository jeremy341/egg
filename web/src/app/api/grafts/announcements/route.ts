import { authed, handle, ok } from "@/server/http";
import { listActiveAnnouncements } from "@/server/grafts/announcements";
import { requireGraftEnabled } from "@/server/grafts/registry";

export const GET = handle(async () => {
  const user = await authed();
  await requireGraftEnabled("announcements");
  return ok({ announcements: await listActiveAnnouncements(user.id) });
});
