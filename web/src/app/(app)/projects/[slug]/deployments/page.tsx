import { Suspense } from "react";
import { notFound } from "next/navigation";
import { DeploymentsView } from "@/components/deployments-view";
import { PageHeader } from "@/components/page-header";
import { FactLine, toneOf } from "@/components/pixel-kit";
import { DeploymentsSkeleton } from "@/components/skeletons/deployments";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { requireUser } from "@/server/auth/current";
import { deploymentPage, projectViews } from "@/server/queries";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  return { title: `${slug} deployments` };
}

async function Content({ params }: Props) {
  const { slug } = await params;
  const user = await requireUser();
  const project = (await projectViews(user.id)).find((p) => p.slug === slug);
  if (!project) notFound();
  // The first page only; the list asks for older ones when you press Load older.
  const { rows: deployments, nextCursor } = await deploymentPage(user.id, {
    projectId: project.id,
    limit: 25,
  });

  const newest = deployments[0];
  // With more pages behind this one the number is a floor, not a total.
  const count = `${deployments.length}${nextCursor ? "+" : ""}`;

  return (
    <div className="motion-enter">
      <PageHeader
        title="Deployments"
        actions={
          <div className="flex flex-col items-start gap-1 max-sm:w-full">
            <a
              href={`/api/projects/${project.id}/deployments/export`}
              download
              className={cn(buttonVariants({ variant: "outline" }), "px-3 max-sm:w-full")}
            >
              Export CSV
            </a>
            <p className="text-xs text-muted-foreground">
              Time, commit, branch, environment, state and duration, up to 5,000 rows.
            </p>
          </div>
        }
        description={
          newest ? (
            <FactLine tones={deployments.slice(0, 24).map((d) => toneOf(d.state))}>
              {count} {deployments.length === 1 && !nextCursor ? "deployment" : "deployments"}. The
              newest {newest.state === "error" ? "failed" : `is ${newest.state}`}
              {newest.age ? `, ${newest.age}` : ""}.
            </FactLine>
          ) : (
            "Every release of this project, newest first."
          )
        }
      />
      <DeploymentsView
        deployments={deployments}
        showProject={false}
        paging={{ projectId: project.id, nextCursor }}
      />
    </div>
  );
}

export default function ProjectDeploymentsPage({ params }: Props) {
  return (
    <Suspense fallback={<DeploymentsSkeleton showProject={false} />}>
      <Content params={params} />
    </Suspense>
  );
}
