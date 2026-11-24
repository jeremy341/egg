"use client";

import { useEffect, useState } from "react";
import { api } from "@/components/api";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

type ProjectRoleName = "admin" | "member" | "viewer";
type MemberView = { userId: string; name: string; email: string | null; role: ProjectRoleName };

const ROLE_LABELS: Record<ProjectRoleName, string> = {
  admin: "Admin: everything, including members and deleting",
  member: "Member: view and change settings, deploy",
  viewer: "Viewer: read only",
};

/** Project members. Only project admins can change them; the server refuses the rest. */
export function ProjectMembersCard({ projectId }: { projectId: string }) {
  const [members, setMembers] = useState<MemberView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ProjectRoleName>("viewer");

  async function load() {
    try {
      setMembers((await api<{ members: MemberView[] }>(`/api/projects/${projectId}/members`)).members);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load members.");
    }
  }

  useEffect(() => {
    void load();
    // load reads only projectId, which is the one prop that changes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Organization members can be added here by email. Personal projects accept any Egg account email.
      </p>
      {error ? <Alert tone="error" role="alert">{error}</Alert> : null}

      <ul className="divide-y rounded-lg shadow-border-small">
        {(members ?? []).map((m) => (
          <li key={m.userId} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <div className="font-medium">{m.name}</div>
              {m.email ? <div className="truncate text-sm text-muted-foreground">{m.email}</div> : null}
            </div>
            <div className="flex items-center gap-2">
              <NativeSelect
                aria-label={`Project role for ${m.name}`}
                value={m.role}
                disabled={busy}
                onChange={(e) =>
                  void act(() => api(`/api/projects/${projectId}/members/${m.userId}`, { method: "PATCH", body: { role: e.target.value } }))
                }
              >
                {(["admin", "member", "viewer"] as const).map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </NativeSelect>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void act(() => api(`/api/projects/${projectId}/members/${m.userId}`, { method: "DELETE" }))}
              >
                Remove {m.name}
              </Button>
            </div>
          </li>
        ))}
        {members && members.length === 0 ? <li className="p-4 text-sm text-muted-foreground">No members yet.</li> : null}
      </ul>

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void act(async () => {
            await api(`/api/projects/${projectId}/members`, { body: { email, role } });
            setEmail("");
          });
        }}
      >
        <label className="grid gap-1.5 text-sm" htmlFor="member-email">
          Add by email
          <Input id="member-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="grid gap-1.5 text-sm" htmlFor="member-role">
          Role
          <NativeSelect id="member-role" value={role} title={ROLE_LABELS[role]} onChange={(e) => setRole(e.target.value as ProjectRoleName)}>
            {(["admin", "member", "viewer"] as const).map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </NativeSelect>
        </label>
        <Button type="submit" disabled={busy || email.trim().length === 0}>Add member</Button>
      </form>
    </div>
  );
}
