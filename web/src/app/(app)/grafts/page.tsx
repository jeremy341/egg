import Link from "next/link";
import { requireUser } from "@/server/auth/current";
import { isInstanceAdmin } from "@/server/admin-identity";
import { listGrafts } from "@/server/grafts/registry";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const metadata = { title: "Apps · Egg" };

export default async function GraftsPage() {
  const user = await requireUser();
  const [grafts, admin] = await Promise.all([listGrafts(), isInstanceAdmin(user.id)]);
  const enabled = grafts.filter((graft) => graft.enabled);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-label text-muted-foreground">Egg apps</p>
          <h1 className="mt-1 text-title-1">Apps</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            First-party tools that add community and project workflows to this Egg instance.
          </p>
        </div>
        {admin ? <Link href="/admin/grafts" className={buttonVariants({ variant: "outline" })}>Manage apps</Link> : null}
      </header>

      {enabled.length === 0 ? (
        <Alert tone="note" title="No apps are enabled">
          {admin ? "Enable an app from Manage apps when you are ready to make it available." : "Ask an instance administrator which apps are available."}
        </Alert>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {enabled.map((graft) => (
            <Card key={graft.id} className="flex h-full flex-col p-5">
              <h2 className="text-title-2">{graft.name}</h2>
              <p className="mt-2 flex-1 text-sm text-muted-foreground">{graft.description}</p>
              {graft.id === "greenhouse" ? (
                <p className="mt-3 text-label text-subtle-foreground">
                  Project workspaces connect to Egg projects and do not run code or agents.
                </p>
              ) : null}
              <Link href={graft.href} className={`${buttonVariants({ variant: "outline" })} mt-5 w-fit`}>
                Open {graft.name}
              </Link>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
