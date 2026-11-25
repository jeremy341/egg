import { requireUser } from "@/server/auth/current";
import { graftIsEnabled } from "@/server/grafts/registry";
import { getWorkspace } from "@/server/grafts/greenhouse";
import { HttpError } from "@/server/http";
import { GreenhouseWorkspace } from "@/components/grafts/greenhouse-workspace";
import { notFound } from "next/navigation";

export const metadata = { title: "Workspace · Greenhouse · Egg" };

export default async function GreenhouseWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!(await graftIsEnabled("greenhouse"))) notFound();
  const { id } = await params;
  let initial: Awaited<ReturnType<typeof getWorkspace>>;
  try {
    initial = await getWorkspace(user.id, id);
  } catch (error) {
    if (error instanceof HttpError && (error.status === 403 || error.status === 404)) notFound();
    throw error;
  }
  return <GreenhouseWorkspace key={id} initial={initial} workspaceId={id} userId={user.id} />;
}
