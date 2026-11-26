import { DomainsView } from "@/components/domains-view";
import { PageHeader } from "@/components/page-header";
import { FactLine, type PixelTone } from "@/components/pixel-kit";
import { DocsLink } from "@/components/settings-ui";
import { requireUser } from "@/server/auth/current";
import { activeDomainWarnings } from "@/server/domains";
import { domainViews, projectViews, serverViews } from "@/server/queries";

export const metadata = { title: "Domains" };

export default async function DomainsPage() {
  const user = await requireUser();
  const [views, projects, servers] = await Promise.all([
    domainViews(user.id),
    projectViews(user.id),
    serverViews(user.id),
  ]);
  // Active domains whose DNS record has gone. Cached for a minute; nothing is removed.
  const warned = await activeDomainWarnings(views);
  const domains = views.map((d) => ({ ...d, dnsWarning: warned.has(d.id) }));

  const invalid = domains.filter((d) => d.status === "invalid" || d.dnsWarning).length;
  const unchecked = domains.filter((d) => d.status === "pending").length;
  const tones: PixelTone[] = domains.map((d) =>
    d.status === "invalid" || d.dnsWarning ? "error" : d.status === "valid" ? "ready" : "neutral"
  );

  return (
    <div className="motion-enter">
      <PageHeader
        className="max-sm:gap-y-0"
        title="Domains"
        description={
          domains.length > 0 ? (
            <FactLine tones={tones}>
              {domains.length} {domains.length === 1 ? "domain" : "domains"}.{" "}
              {invalid > 0
                ? `${invalid} ${invalid === 1 ? "needs" : "need"} attention.`
                : unchecked > 0
                  ? `${unchecked} waiting for DNS.`
                  : "All active."}
            </FactLine>
          ) : (
            "Route a domain to a port on your Nest container."
          )
        }
        actions={<DocsLink href="/docs/domains" topic="domains" className="max-sm:hidden" />}
      />
      <DomainsView
        initial={domains}
        servers={servers.map((s) => ({ id: s.id, nestUsername: s.nestUsername }))}
        projects={projects.filter((p) => p.workloadKind !== "worker" && p.listenPort !== null).map((p) => ({
          id: p.id,
          name: p.name,
          port: p.listenPort!,
          serverId: p.serverId,
        }))}
      />
    </div>
  );
}
