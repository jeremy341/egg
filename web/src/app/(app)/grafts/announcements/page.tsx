import { requireUser } from "@/server/auth/current";
import { isInstanceAdmin } from "@/server/admin-identity";
import { listActiveAnnouncements, listManagedAnnouncements } from "@/server/grafts/announcements";
import { graftIsEnabled } from "@/server/grafts/registry";
import { GraftAnnouncements } from "@/components/grafts/graft-announcements";
import { notFound } from "next/navigation";

export const metadata = { title: "Announcements · Egg" };

export default async function AnnouncementsPage() {
  const user = await requireUser();
  if (!(await graftIsEnabled("announcements"))) notFound();
  const admin = await isInstanceAdmin(user.id);
  const [feed, managed] = await Promise.all([
    listActiveAnnouncements(user.id),
    admin ? listManagedAnnouncements() : Promise.resolve([]),
  ]);
  return <GraftAnnouncements initialFeed={feed} initialManaged={managed} isAdmin={admin} />;
}
