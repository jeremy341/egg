import { notFound } from "next/navigation";
import { ErrorGroupsView } from "@/components/error-groups-view";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/server/auth/current";
import { projectViews } from "@/server/queries";
import { getProjectRole } from "@/server/project-roles";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  return { title: `${slug} errors` };
}

/** JavaScript errors grouped by likely cause, with triage. Opens from the project's analytics. */
export default async function ProjectErrorsPage({ params }: Props) {
  const { slug } = await params;
  const user = await requireUser();
  const project = (await projectViews(user.id)).find((p) => p.slug === slug);
  if (!project) notFound();
  const canEdit = (await getProjectRole(user.id, project.id)) === "owner";
  return (
    <div className="motion-enter space-y-6">
      <PageHeader
        title="Errors"
        description="Errors from your site, grouped by message and file. Numbers and ids are ignored when grouping."
      />
      <ErrorGroupsView projectId={project.id} currentUserId={user.id} canEdit={canEdit} />
    </div>
  );
}
