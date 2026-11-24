"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/components/api";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  assignableRoles,
  canChangeRoles,
  canInvite,
  canRemoveMember,
  ORG_ROLE_LABELS,
  type OrgRoleName,
} from "@/lib/org-roles";

export type OrgMemberView = { userId: string; name: string; email: string | null; role: OrgRoleName };
export type OrgInvitationView = { id: string; email: string; role: OrgRoleName; expiresAt: string };

type Props = {
  orgId: string;
  orgName: string;
  myId: string;
  myRole: OrgRoleName;
  members: OrgMemberView[];
  invitations: OrgInvitationView[];
};

type InvitationReply = { invitation: { delivery: string; link?: string } };

/** The people and settings of one organization. These controls only hide what the role cannot do; the server checks each action. */
export function OrganizationDetail({ orgId, orgName, myId, myRole, members, invitations }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** A one-time invitation link. Shown once; the server never returns it again. */
  const [link, setLink] = useState<string | null>(null);
  const [name, setName] = useState(orgName);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<OrgRoleName>("member");

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  function reportInvitation(reply: InvitationReply, sentTo: string) {
    if (reply.invitation.delivery === "link" && reply.invitation.link) {
      setLink(reply.invitation.link);
      setNotice("No email is set up here. Send this link to the person yourself. It is shown only once.");
    } else {
      setLink(null);
      setNotice(`Invitation sent to ${sentTo}.`);
    }
  }

  const roleOptions = assignableRoles(myRole);
  const canManage = myRole === "owner" || myRole === "admin";

  return (
    <div className="space-y-10">
      {error ? <Alert tone="error" role="alert">{error}</Alert> : null}
      {notice ? <Alert tone="info" role="status">{notice}</Alert> : null}
      {link ? (
        <Input readOnly value={link} aria-label="One-time invitation link" onFocus={(e) => e.currentTarget.select()} />
      ) : null}

      {canManage ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const sentTo = email;
            void run(async () => {
              const reply = await api<InvitationReply>(`/api/orgs/${orgId}/invitations`, {
                body: { email, role: inviteRole },
              });
              reportInvitation(reply, sentTo);
              setEmail("");
            });
          }}
        >
          <label className="grid gap-1.5 text-sm" htmlFor="invite-email">
            Invite by email
            <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="grid gap-1.5 text-sm" htmlFor="invite-role">
            Role
            <NativeSelect id="invite-role" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as OrgRoleName)}>
              {roleOptions.map((r) => (
                <option key={r} value={r}>{ORG_ROLE_LABELS[r]}</option>
              ))}
            </NativeSelect>
          </label>
          <Button type="submit" disabled={busy || email.trim().length === 0}>Send invitation</Button>
        </form>
      ) : null}

      <section aria-labelledby="org-members" className="space-y-3">
        <h2 id="org-members" className="text-title-2">Members</h2>
        <ul className="divide-y rounded-lg shadow-border-small">
          {members.map((m) => {
            const isSelf = m.userId === myId;
            return (
              <li key={m.userId} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="font-medium">
                    {m.name}
                    {isSelf ? " (you)" : ""}
                  </div>
                  {m.email ? <div className="truncate text-sm text-muted-foreground">{m.email}</div> : null}
                </div>
                <div className="flex items-center gap-2">
                  {canChangeRoles(myRole) && !isSelf ? (
                    <NativeSelect
                      aria-label={`Role for ${m.name}`}
                      value={m.role}
                      disabled={busy}
                      onChange={(e) =>
                        void run(async () => {
                          await api(`/api/orgs/${orgId}/members/${m.userId}`, { method: "PATCH", body: { role: e.target.value } });
                        })
                      }
                    >
                      {(["owner", "admin", "member", "guest"] as const).map((r) => (
                        <option key={r} value={r}>{ORG_ROLE_LABELS[r]}</option>
                      ))}
                    </NativeSelect>
                  ) : (
                    <span className="text-sm text-muted-foreground">{ORG_ROLE_LABELS[m.role]}</span>
                  )}
                  {canRemoveMember(myRole, m.role, isSelf) ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await api(`/api/orgs/${orgId}/members/${m.userId}`, { method: "DELETE" });
                        })
                      }
                    >
                      Remove {m.name}
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {canManage ? (
        <section aria-labelledby="org-invites" className="space-y-3">
          <h2 id="org-invites" className="text-title-2">Pending invitations</h2>
          {invitations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No invitations waiting.</p>
          ) : (
            <ul className="divide-y rounded-lg shadow-border-small">
              {invitations.map((inv) => (
                <li key={inv.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{inv.email}</div>
                    <div className="text-sm text-muted-foreground">
                      {ORG_ROLE_LABELS[inv.role]}, expires {new Date(inv.expiresAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const reply = await api<InvitationReply>(`/api/orgs/${orgId}/invitations/${inv.id}/resend`, { method: "POST" });
                          reportInvitation(reply, inv.email);
                        })
                      }
                    >
                      Resend
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await api(`/api/orgs/${orgId}/invitations/${inv.id}`, { method: "DELETE" });
                        })
                      }
                    >
                      Cancel
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {canManage ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api(`/api/orgs/${orgId}`, { method: "PATCH", body: { name } });
            });
          }}
        >
          <label className="grid gap-1.5 text-sm" htmlFor="org-rename">
            Organization name
            <Input id="org-rename" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
          </label>
          <Button type="submit" variant="outline" disabled={busy || name.trim().length === 0}>Save name</Button>
        </form>
      ) : null}

      {myRole === "owner" ? (
        <p className="text-sm text-muted-foreground">Owners must give the owner role to another member before they can leave.</p>
      ) : (
        <div>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api(`/api/orgs/${orgId}/leave`, { method: "POST" });
                router.push("/organizations");
              })
            }
          >
            Leave organization
          </Button>
        </div>
      )}
    </div>
  );
}
