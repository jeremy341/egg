import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { TerminalSkeleton } from "@/components/terminal-skeleton";
import { TerminalView } from "@/components/terminal-view";
import { Alert } from "@/components/ui/alert";
import { permissionsOrDefault } from "@/lib/container-permissions";
import { ROLE_LABEL, ROLE_NOTE } from "@/lib/team";
import { requireUser } from "@/server/auth/current";
import { getPermissions } from "@/server/permissions";
import { getProjectRole } from "@/server/project-roles";
import { projectViews } from "@/server/queries";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  return { title: `${slug} terminal` };
}

async function Content({ params }: Props) {
  const { slug } = await params;
  const user = await requireUser();
  const project = (await projectViews(user.id)).find((p) => p.slug === slug);
  if (!project) notFound();

  const role = await getProjectRole(user.id, project.id);
  if (role !== "owner") {
    // Every terminal request for a member answers 404, so this page only says what their access is.
    const mine = role === "developer" || role === "viewer" ? role : null;
    return (
      <>
        <PageHeader
          title="Terminal"
          description="A live shell on your Nest container, starting in this project's folder."
        />
        <div className="mx-auto w-full max-w-[720px]">
          <Alert tone="note" title="Only the owner uses the terminal">
            {mine ? (
              <p>
                You are a {ROLE_LABEL[mine].toLowerCase()} on this project. {ROLE_NOTE[mine]}
              </p>
            ) : (
              <p>Ask the project owner to use the terminal.</p>
            )}
          </Alert>
        </div>
      </>
    );
  }

  // If the permissions cannot be read, the terminal counts as off (the default).
  const permissions = await permissionsOrDefault(() => getPermissions(user.id, project.serverId));

  return (
    <div className="motion-enter">
      <PageHeader
        title="Terminal"
        description="A live shell on your Nest container, starting in this project's folder."
      />
      <TerminalView
        projectId={project.id}
        projectName={project.name}
        host={`${project.nestUsername}.hackclub.app`}
        enabled={permissions.terminal}
      />
    </div>
  );
}

export default function ProjectTerminalPage({ params }: Props) {
  return (
    <Suspense fallback={<TerminalSkeleton />}>
      <Content params={params} />
    </Suspense>
  );
}
