"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/components/api";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { ORG_ROLE_LABELS, type OrgRoleName } from "@/lib/org-roles";

export type OrgListItem = { id: string; name: string; role: OrgRoleName };

/** Organizations the signed-in user belongs to, and a form to create one. */
export function OrganizationsView({ organizations }: { organizations: OrgListItem[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const org = await api<{ id: string }>("/api/orgs", { body: { name } });
      router.push(`/organizations/${org.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the organization.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      {organizations.length === 0 ? (
        <EmptyState title="No organizations yet" description="Create one to share projects with a team." />
      ) : (
        <ul className="divide-y rounded-lg shadow-border-small">
          {organizations.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-3 p-4">
              <Link href={`/organizations/${o.id}`} className="font-medium hover:underline">
                {o.name}
              </Link>
              <span className="text-sm text-muted-foreground">{ORG_ROLE_LABELS[o.role]}</span>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={create} className="space-y-3">
        <h2 className="text-title-2">New organization</h2>
        <label className="grid gap-1.5 text-sm" htmlFor="org-name">
          Name
          <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
        </label>
        {error ? <Alert tone="error" role="alert">{error}</Alert> : null}
        <Button type="submit" disabled={busy || name.trim().length === 0}>
          Create organization
        </Button>
      </form>
    </div>
  );
}
