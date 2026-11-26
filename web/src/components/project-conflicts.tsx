import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Conflict, ConflictKind } from "@/server/adoption";

const KIND: Record<ConflictKind, string> = {
  unit: "Service",
  folder: "Folder",
  port: "Port",
  process: "Running program",
  checkout: "Git checkout",
};

/** Blocking first, then what Nest Deploy made, then the rest. */
function order(a: Conflict, b: Conflict) {
  const rank = (c: Conflict) => (c.blocking ? 0 : c.managedByNestDeploy ? 2 : 1);
  return rank(a) - rank(b);
}

/**
 * What is already on the container where a project is about to go, in plain
 * words. It only reports: there is no button here that stops, moves or deletes
 * anything on the container. Dealing with a blocking item is the owner's own
 * job, on their own container.
 */
export function ProjectConflicts({ conflicts, className }: { conflicts: Conflict[]; className?: string }) {
  if (conflicts.length === 0) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)} role="status">
        Nothing on this container is in the way.
      </p>
    );
  }
  const blocking = conflicts.filter((c) => c.blocking).length;
  const sorted = [...conflicts].sort(order);

  return (
    <section className={cn("space-y-3", className)} aria-label="What is already on this container">
      <p className="text-sm" role="status">
        {blocking > 0
          ? `${blocking} ${blocking === 1 ? "thing needs" : "things need"} your attention before the first deploy. Nest Deploy will not change them for you.`
          : "Nothing blocks the first deploy. Here is what is already there."}
      </p>
      <ul className="divide-y rounded-lg border">
        {sorted.map((c) => (
          <li key={`${c.kind}:${c.name}`} className="flex flex-col gap-1.5 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-label text-muted-foreground">{KIND[c.kind]}</span>
              <code className="break-all text-sm font-medium">{c.name}</code>
              {c.blocking ? (
                <Badge variant="destructive">Blocks the deploy</Badge>
              ) : c.managedByNestDeploy ? (
                <Badge variant="secondary">Made by Nest Deploy</Badge>
              ) : (
                <Badge variant="outline">Good to know</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{c.detail}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
