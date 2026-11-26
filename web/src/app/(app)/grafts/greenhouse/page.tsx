import { requireUser } from "@/server/auth/current";
import { isInstanceAdmin } from "@/server/admin-identity";
import { graftIsEnabled } from "@/server/grafts/registry";
import { listAdminWorkspaces, listUserWorkspaces, listWorkspaceProjects } from "@/server/grafts/greenhouse";
import { GreenhouseBoard } from "@/components/grafts/greenhouse-board";
import { notFound } from "next/navigation";

export const metadata = { title: "Greenhouse · Egg" };

export default async function GreenhousePage() {
  const user = await requireUser();
  if (!(await graftIsEnabled("greenhouse"))) notFound();
  const isAdmin = await isInstanceAdmin(user.id);
  const [projects, workspaces, adminWorkspaces] = await Promise.all([
    listWorkspaceProjects(user.id),
    listUserWorkspaces(user.id),
    isAdmin ? listAdminWorkspaces() : Promise.resolve([]),
  ]);
  return <GreenhouseBoard initialProjects={projects} initialWorkspaces={workspaces} initialAdminWorkspaces={adminWorkspaces} isAdmin={isAdmin} />;
}
