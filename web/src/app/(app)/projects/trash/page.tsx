import { PageHeader } from "@/components/page-header";
import { TrashedProjects } from "@/components/trashed-projects";
import { requireUser } from "@/server/auth/current";
import { listTrashedProjects } from "@/server/project-trash";

export const metadata = { title: "Recently deleted" };

export default async function TrashPage() {
  const user = await requireUser();
  const rows = await listTrashedProjects(user.id);
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Recently deleted"
        description="Deleted apps wait here for 30 days. Restore one to bring back its settings, environment variables and deployment history."
      />
      <TrashedProjects
        rows={rows.map((r) => ({
          projectId: r.projectId,
          name: r.name,
          slug: r.slug,
          deletedAt: r.deletedAt.toISOString(),
          purgeAt: r.purgeAt.toISOString(),
        }))}
      />
    </div>
  );
}
