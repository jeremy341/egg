import { audit } from "@/server/audit";
import { authed, handle, ok, readJson } from "@/server/http";
import { createAnnouncement, createAnnouncementInput, listManagedAnnouncements } from "@/server/grafts/announcements";
import { requireGraftAdmin, requireGraftEnabled } from "@/server/grafts/registry";

export const GET = handle(async () => {
  const user = await authed();
  await requireGraftAdmin(user.id);
  await requireGraftEnabled("announcements");
  return ok({ announcements: await listManagedAnnouncements() });
});

export const POST = handle(async (req) => {
  const user = await authed();
  await requireGraftAdmin(user.id);
  await requireGraftEnabled("announcements");
  const input = await readJson(req, createAnnouncementInput);
  await createAnnouncement(user.id, input);
  await audit(user.id, "graft.announcement.create", undefined, undefined, { level: "instance" });
  return ok({ created: true }, 201);
});
