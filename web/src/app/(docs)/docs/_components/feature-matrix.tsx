import Link from "next/link";
import { C, H2, P, Table } from "./prose";

type Feature = {
  name?: string;
  status?: string;
  ours?: string | null;
  reason?: string;
  endpoint?: string;
  explanation?: string;
};

type Manifest = { tools?: Feature[] };

const groups = [
  { status: "present", title: "Available in Egg", description: "Egg has an endpoint that covers this Orchard tool." },
  { status: "partial", title: "Partially available", description: "Egg has a related endpoint, with a narrower or different scope." },
  { status: "not_applicable", title: "Not applicable", description: "This Orchard tool does not apply to Egg's model." },
] as const;

function endpointHref(id: string) {
  return `/docs/api#${encodeURIComponent(id)}`;
}

export function FeatureMatrix({ manifest }: { manifest: Manifest }) {
  const tools = Array.isArray(manifest.tools) ? manifest.tools : [];
  return (
    <div className="mt-10 [&>:first-child]:mt-0">
      <P>Compared with Orchard&apos;s MCP tools, Egg covers the tools below. The checklist is generated from the current parity manifest.</P>
      {groups.map((group) => {
        const rows = tools.filter((tool) => tool.status === group.status);
        if (!rows.length) return null;
        return (
          <section key={group.status} aria-labelledby={`features-${group.status}`}>
            <H2 id={`features-${group.status}`} title={`${group.title} (${rows.length})`} />
            <P>{group.description}</P>
            <Table
              caption={group.title}
              head={["Orchard tool", "Egg endpoint", "Notes"]}
              rows={rows.map((tool, index) => {
                const name = tool.name || "Unnamed tool";
                const endpoint = tool.endpoint || tool.ours || null;
                const note = tool.reason || tool.explanation || (group.status === "present"
                  ? "Supported by Egg."
                  : group.status === "partial" ? "Related support is available with a different scope." : "Not applicable to Egg.");
                return [
                  <C key={`name-${index}`}>{name}</C>,
                  endpoint ? <Link key={`endpoint-${index}`} className="link font-medium text-foreground" href={endpointHref(endpoint)}><C>{endpoint}</C></Link> : "—",
                  note,
                ];
              })}
            />
          </section>
        );
      })}
    </div>
  );
}
