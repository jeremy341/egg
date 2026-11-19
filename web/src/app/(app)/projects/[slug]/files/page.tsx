import { Suspense } from "react";
import { notFound } from "next/navigation";
import { FileManager } from "@/components/file-manager";
import { FilesSkeleton } from "@/components/file-manager-skeleton";
import { PageHeader } from "@/components/page-header";
import { Alert } from "@/components/ui/alert";
import { permissionsOrDefault } from "@/lib/container-permissions";
import { ROLE_LABEL, ROLE_NOTE } from "@/lib/team";
import { requireUser } from "@/server/auth/current";
import { getPermissions } from "@/server/permissions";
import { getProjectRole } from "@/server/project-roles";
import { projectViews } from "@/server/queries";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ path?: string | string[] }>;
};

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  return { title: `${slug} files` };
}

async function Content({ params, searchParams }: Props) {
  const { slug } = await params;
  const { path } = await searchParams;
  const user = await requireUser();
  const project = (await projectViews(user.id)).find((p) => p.slug === slug);
  if (!project) notFound();

  const role = await getProjectRole(user.id, project.id);
  if (role !== "owner") {
    // The server answers every file request for a member with 404, so this page only says what their access is.
    const mine = role === "developer" || role === "viewer" ? role : null;
    return (
      <>
        <PageHeader
          className="mb-2"
          title="Files"
          description={`Browse and download files in ${project.name}'s folder on your container.`}
        />
        <div className="mx-auto w-full max-w-[720px]">
          <Alert tone="note" title="Only the owner uses the files">
            {mine ? (
              <p>
                You are a {ROLE_LABEL[mine].toLowerCase()} on this project. {ROLE_NOTE[mine]}
              </p>
            ) : (
              <p>Ask the project owner for file changes.</p>
            )}
          </Alert>
        </div>
      </>
    );
  }

  // If the permissions cannot be read, file changes keep their default (on); the server still enforces.
  const permissions = await permissionsOrDefault(() => getPermissions(user.id, project.serverId));
  return (
    <FileManager
      projectId={project.id}
      slug={project.slug}
      projectName={project.name}
      fileWrites={permissions.fileWrites}
      initialPath={Array.isArray(path) ? (path[0] ?? "") : (path ?? "")}
    />
  );
}

export default function ProjectFilesPage(props: Props) {
  return (
    <Suspense fallback={<FilesSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}
