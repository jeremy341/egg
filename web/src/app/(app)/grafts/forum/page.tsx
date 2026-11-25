import { requireUser } from "@/server/auth/current";
import { isInstanceAdmin } from "@/server/admin-identity";
import { graftIsEnabled } from "@/server/grafts/registry";
import { listForumThreads } from "@/server/grafts/forum";
import { ForumBoard } from "@/components/grafts/forum-board";
import { notFound } from "next/navigation";

export const metadata = { title: "Forum · Egg" };

export default async function ForumPage() {
  const user = await requireUser();
  if (!(await graftIsEnabled("forum"))) notFound();
  const [threads, isAdmin] = await Promise.all([listForumThreads(user.id), isInstanceAdmin(user.id)]);
  return <ForumBoard initialThreads={threads} userId={user.id} isAdmin={isAdmin} />;
}
