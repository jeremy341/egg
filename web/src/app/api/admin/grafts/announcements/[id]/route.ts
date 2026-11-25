import { audit } from "@/server/audit";
import { authed, handle, ok, readJson } from "@/server/http";
import { deleteAnnouncement, updateAnnouncement, updateAnnouncementInput } from "@/server/grafts/announcements";
import { requireGraftAdmin, requireGraftEnabled } from "@/server/grafts/registry";

type Context = { params: Promise<{ id: string }> };

export const PATCH = handle<Context>(async (req, { params }) => {
  const user = await authed();
  await requireGraftAdmin(user.id);
  await requireGraftEnabled("announcements");
  const { id } = await params;
  await updateAnnouncement(id, await readJson(req, updateAnnouncementInput));
  await audit(user.id, "graft.announcement.update", id, undefined, { level: "instance" });
  return ok({ updated: true });
});

export const DELETE = handle<Context>(async (_req, { params }) => {
  const user = await authed();
  await requireGraftAdmin(user.id);
  await requireGraftEnabled("announcements");
  const { id } = await params;
  await deleteAnnouncement(id);
  await audit(user.id, "graft.announcement.delete", id, undefined, { level: "instance" });
  return ok({ deleted: true });
});
