import { getCurrentUser } from "@/server/auth/current";
import { graftIsEnabled } from "@/server/grafts/registry";
import { listActiveAnnouncements } from "@/server/grafts/announcements";
import { AnnouncementBanners } from "@/components/grafts/announcement-banners";

/** Instance-wide published notices, rendered in the signed-in app shell. */
export async function GraftAnnouncementsBanner() {
  const user = await getCurrentUser();
  if (!user || !(await graftIsEnabled("announcements"))) return null;
  const announcements = await listActiveAnnouncements(user.id, { undismissedOnly: true });
  if (announcements.length === 0) return null;
  const key = announcements.map((item) => `${item.id}:${item.updatedAt}`).join(",");
  return <AnnouncementBanners key={key} initial={announcements.slice(0, 3)} />;
}
