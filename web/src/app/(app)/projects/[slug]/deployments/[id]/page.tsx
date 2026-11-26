import { Suspense } from "react";
import { notFound } from "next/navigation";
import {
  ArrowUpRightIcon,
  GitBranchIcon,
  GitCommitIcon,
} from "@phosphor-icons/react/dist/ssr";
import { BuildLogs } from "@/components/build-logs";
import { CommitLink } from "@/components/commit-link";
import { DeploymentActions } from "@/components/deployment-actions";
import { DeploymentTimeline } from "@/components/deployment-timeline";
import { PageHeader } from "@/components/page-header";
import { DeploymentSkeleton } from "@/components/skeletons/deployment";
import { StatusDot } from "@/components/status-dot";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/server/auth/current";
import { deploymentTimeline } from "@/server/deployment-timeline";
import { deploymentLogs } from "@/server/projects";
import { deploymentView } from "@/server/queries";

type Props = { params: Promise<{ slug: string; id: string }> };

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  return { title: `Deployment ${id.slice(0, 7)}` };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="mb-1 text-label text-muted-foreground">{label}</dt>
      <dd className="font-medium tracking-[-0.02em]">{children}</dd>
    </div>
  );
}

async function Content({ params }: Props) {
  const { slug, id } = await params;
  const user = await requireUser();
  let data;
  try {
    data = await deploymentView(user.id, id);
  } catch {
    notFound();
  }
  const { deployment: d, project, domains, postDeployCheck, postDeployWaiting } = data;
  if (project.slug !== slug) notFound();

  const logs = (await deploymentLogs(user.id, id)).map((l) => ({
    id: l.id,
    at: l.at.toISOString(),
    level: l.level,
    message: l.message,
  }));
  const timeline = await deploymentTimeline(id, logs);
  const address = domains[0];

  return (
    <div className="motion-enter space-y-6">
      <PageHeader
        title={
          <>
            Deployment <span className="font-mono">{id.slice(0, 8)}</span>
          </>
        }
        description={
          <span className="flex flex-col gap-1">
            <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-foreground">
              <span data-tour="deployment-status" data-tour-state={d.state} data-tour-port={d.port}>
                <StatusDot state={d.state} />
              </span>
              {d.state !== "building" && d.state !== "queued" ? (
                <span className="tabular text-muted-foreground">{d.duration}</span>
              ) : null}
              {d.isCurrent ? <span className="text-muted-foreground">Current release</span> : null}
            </span>
            {d.commit ? <span>{d.commit}</span> : null}
          </span>
        }
        actions={
          <>
            {address ? (
              <Button
                data-tour="visit"
                className="px-3"
                render={<a href={`https://${address}`} target="_blank" rel="noreferrer" />}
              >
                Visit
                <ArrowUpRightIcon aria-hidden="true" />
                <span className="sr-only">(opens in a new tab)</span>
              </Button>
            ) : null}
            <DeploymentActions deployment={d} />
          </>
        }
      />

      {timeline ? (
        <DeploymentTimeline timeline={timeline} repo={d.repo} sha={d.sha} />
      ) : d.state === "error" && d.error ? (
        <p data-tour="error-summary" className="text-[var(--status-error)]">
          {d.error}
        </p>
      ) : null}

      {postDeployCheck || postDeployWaiting ? (
        <section
          aria-labelledby="regression-heading"
          className="overflow-hidden rounded-lg bg-card shadow-border-small"
        >
          <div className="border-b px-4 py-3">
            <h2 id="regression-heading" className="text-title-3">
              After this deploy
            </h2>
          </div>
          {postDeployCheck ? (
            <div className="space-y-3 p-4 text-[13px]">
              <p className="font-medium">
                {postDeployCheck.verdict === "regressed"
                  ? "Regressed: the app got slower or less reliable after this deploy."
                  : postDeployCheck.verdict === "ok"
                    ? "No regression: the 15 minutes after the deploy look like the 15 minutes before."
                    : "Not enough checks to compare the 15 minutes before and after."}
              </p>
              {postDeployCheck.reasons.length > 0 ? (
                <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                  {postDeployCheck.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              ) : null}
              <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-3">
                <div>
                  <dt className="text-label text-muted-foreground">P95 latency</dt>
                  <dd className="tabular">
                    {postDeployCheck.before.p95Ms === null ? "n/a" : `${Math.round(postDeployCheck.before.p95Ms)} ms`}
                    {" → "}
                    {postDeployCheck.after.p95Ms === null ? "n/a" : `${Math.round(postDeployCheck.after.p95Ms)} ms`}
                  </dd>
                </div>
                <div>
                  <dt className="text-label text-muted-foreground">Error rate</dt>
                  <dd className="tabular">
                    {postDeployCheck.before.errorRate === null ? "n/a" : `${Math.round(postDeployCheck.before.errorRate * 1000) / 10}%`}
                    {" → "}
                    {postDeployCheck.after.errorRate === null ? "n/a" : `${Math.round(postDeployCheck.after.errorRate * 1000) / 10}%`}
                  </dd>
                </div>
                <div>
                  <dt className="text-label text-muted-foreground">Restarts after deploy</dt>
                  <dd className="tabular">{postDeployCheck.after.restarts}</dd>
                </div>
              </dl>
              <p className="text-label text-muted-foreground">
                Compared 15 minutes before and after the deploy became ready. Based on the health checks Egg makes once a minute, not on visitor traffic.
              </p>
            </div>
          ) : (
            <p className="p-4 text-[13px] text-muted-foreground">
              Checking the 15 minutes after this deploy. The result appears here shortly after.
            </p>
          )}
        </section>
      ) : null}

      <section
        aria-labelledby="details-heading"
        className="overflow-hidden rounded-lg bg-card shadow-border-small"
      >
        <div className="border-b px-4 py-3">
          <h2 id="details-heading" className="text-title-3">
            Details
          </h2>
        </div>

        <dl className="grid gap-x-6 gap-y-5 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Created">
            <span className="inline-flex items-center gap-2">
              <Avatar size="sm">
                <AvatarFallback className="text-[10px] uppercase">
                  {(d.author ?? "?").slice(0, 2)}
                </AvatarFallback>
              </Avatar>
              {d.author ?? d.source}
              <span className="font-normal text-muted-foreground">{d.age}</span>
            </span>
          </Field>
          <Field label="Duration">{d.duration}</Field>
          <Field label="Environment">{d.env === "preview" ? "Preview" : "Production"}</Field>
          <Field label="Address">
            <span className="break-all">
              {address ?? (
                <span className="font-normal text-muted-foreground">No domain recorded</span>
              )}
            </span>
          </Field>
          <Field label="Port">
            <span className="tabular font-mono text-[13px] font-normal">{d.port}</span>
          </Field>
          <div className="min-w-0 sm:col-span-2 lg:col-span-3">
            <dt className="mb-1 text-label text-muted-foreground">Source</dt>
            <dd className="space-y-1">
              <p className="flex items-center gap-1.5 font-mono text-[13px]">
                <GitBranchIcon aria-hidden="true" className="size-4 shrink-0" />
                {d.branch}
              </p>
              <p className="flex min-w-0 items-center gap-1.5">
                <GitCommitIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <CommitLink
                  repo={d.repo}
                  sha={d.sha}
                  fallback="pending"
                  className="shrink-0 font-mono text-[13px]"
                />
                <span className="truncate">{d.commit}</span>
              </p>
            </dd>
          </div>
        </dl>
      </section>

      <BuildLogs
        key={`${d.id}-${d.rawState}`}
        deploymentId={d.id}
        initialLines={logs}
        rawState={d.rawState}
        duration={d.duration}
      />
    </div>
  );
}

export default function DeploymentPage({ params }: Props) {
  return (
    <Suspense fallback={<DeploymentSkeleton />}>
      <Content params={params} />
    </Suspense>
  );
}
