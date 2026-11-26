import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { ProjectSettings } from "@/components/project-settings";
import { SettingsSkeleton } from "@/components/skeletons/settings";
import { Alert } from "@/components/ui/alert";
import { ROLE_LABEL, ROLE_NOTE } from "@/lib/team";
import { requireUser } from "@/server/auth/current";
import { listEnvVars } from "@/server/projects";
import { getProjectRole } from "@/server/project-roles";
import { projectViews } from "@/server/queries";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  return { title: `${slug} settings` };
}

async function Content({ params }: Props) {
  const { slug } = await params;
  const user = await requireUser();
  const project = (await projectViews(user.id)).find((p) => p.slug === slug);
  if (!project) notFound();

  const role = await getProjectRole(user.id, project.id);
  if (role !== "owner") {
    // The server refuses configuration to anyone but the owner, so this page only says what their access is.
    const mine = role === "developer" || role === "viewer" ? role : null;
    return (
      <>
        <PageHeader
          title="Settings"
          description={`${project.name} on ${project.nestUsername}.hackclub.app`}
        />
        <div className="mx-auto w-full max-w-[720px]">
          <Alert tone="note" title="Only the owner changes the settings">
            {mine ? (
              <p>
                You are a {ROLE_LABEL[mine].toLowerCase()} on this project. {ROLE_NOTE[mine]}
              </p>
            ) : (
              <p>Ask the project owner to change the settings.</p>
            )}
          </Alert>
        </div>
      </>
    );
  }

  const env = await listEnvVars(user.id, project.id);
  return <ProjectSettings project={project} env={env} />;
}

export default function ProjectSettingsPage({ params }: Props) {
  return (
    <Suspense fallback={<SettingsSkeleton />}>
      <Content params={params} />
    </Suspense>
  );
}
