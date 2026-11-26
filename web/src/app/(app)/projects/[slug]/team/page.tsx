import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { ProjectTeam, type TeamInvitation, type TeamMember } from "@/components/project-team";
import { SettingsSkeleton } from "@/components/skeletons/settings";
import { Alert } from "@/components/ui/alert";
import { ROLE_LABEL, ROLE_NOTE } from "@/lib/team";
import { requireUser } from "@/server/auth/current";
import { getProjectRole, listProjectInvitations, listProjectMembers } from "@/server/project-roles";
import { projectViews } from "@/server/queries";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  return { title: `${slug} team` };
}

async function Content({ params }: Props) {
  const { slug } = await params;
  const user = await requireUser();
  const project = (await projectViews(user.id)).find((p) => p.slug === slug);
  if (!project) notFound();

  const role = await getProjectRole(user.id, project.id);
  if (role !== "owner") {
    // The server refuses members and invitations to anyone but the owner, so this page only says what their access is.
    const mine = role === "developer" || role === "viewer" ? role : null;
    return (
      <>
        <PageHeader title="Team" description={`Who can see and run ${project.name}.`} />
        <div className="mx-auto w-full max-w-[720px]">
          <Alert tone="note" title="Only the owner manages the team">
            {mine ? (
              <p>
                You are a {ROLE_LABEL[mine].toLowerCase()} on this project. {ROLE_NOTE[mine]}
              </p>
            ) : (
              <p>Ask the project owner to invite people.</p>
            )}
          </Alert>
        </div>
      </>
    );
  }

  const [members, invitations] = await Promise.all([
    listProjectMembers(user.id, project.id),
    listProjectInvitations(user.id, project.id),
  ]);
  // Dates cross to the browser as text, the same as the JSON the API sends.
  const teamMembers: TeamMember[] = members.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() }));
  const teamInvitations: TeamInvitation[] = invitations.map((i) => ({
    ...i,
    createdAt: i.createdAt.toISOString(),
    expiresAt: i.expiresAt.toISOString(),
    acceptedAt: i.acceptedAt ? i.acceptedAt.toISOString() : null,
  }));

  return (
    <ProjectTeam
      projectId={project.id}
      projectName={project.name}
      ownerName={user.name ?? user.email ?? "You"}
      members={teamMembers}
      invitations={teamInvitations}
    />
  );
}

export default function ProjectTeamPage({ params }: Props) {
  return (
    <Suspense fallback={<SettingsSkeleton />}>
      <Content params={params} />
    </Suspense>
  );
}
