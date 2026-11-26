import { requireUser } from "@/server/auth/current";
import { isInstanceAdmin } from "@/server/admin-identity";
import { graftIsEnabled } from "@/server/grafts/registry";
import { getForumThread } from "@/server/grafts/forum";
import { HttpError } from "@/server/http";
import { ForumThread } from "@/components/grafts/forum-thread";
import { notFound } from "next/navigation";

export const metadata = { title: "Forum topic · Egg" };

export default async function ForumThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!(await graftIsEnabled("forum"))) notFound();
  const { id } = await params;
  let initial: Awaited<ReturnType<typeof getForumThread>>;
  try {
    initial = await getForumThread(user.id, id);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) notFound();
    throw error;
  }
  return <ForumThread key={id} initial={initial} threadId={id} userId={user.id} isAdmin={await isInstanceAdmin(user.id)} />;
}
