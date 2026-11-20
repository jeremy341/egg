"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/components/api";
import { CopyButton } from "@/components/developer-docs";
import { LocalTime } from "@/components/local-time";
import { PageHeader } from "@/components/page-header";
import { Card, Label } from "@/components/settings-ui";
import { Alert } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { toast } from "@/components/ui/toast";
import { errorText } from "@/lib/developer";
import {
  INVITE_DAYS,
  MAX_OPEN_INVITES,
  ROLES,
  ROLE_LABEL,
  ROLE_NOTE,
  expiryText,
  inviteLink,
  isOpenInvitation,
  type MemberRole,
} from "@/lib/team";

export type TeamMember = {
  userId: string;
  role: MemberRole;
  createdAt: string;
  name: string | null;
  email: string | null;
};

export type TeamInvitation = {
  id: string;
  email: string;
  invitedUserId: string | null;
  role: MemberRole;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
};

const LIST = "hairline-y overflow-hidden rounded-md shadow-border-small";
const ROW = "flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3";

/** A member's row with its role replaced. */
export function applyRole(members: TeamMember[], userId: string, next: MemberRole): TeamMember[] {
  return members.map((m) => (m.userId === userId ? { ...m, role: next } : m));
}

/**
 * A failed role change must fall back to server truth. Rebuilding the row locally
 * is unsafe: two interleaved failures can each "undo" toward a different stale
 * value. Re-rendering from the server discards all local guesses at once.
 */
export function onRoleChangeFailed(refresh: () => void): void {
  refresh();
}

/**
 * The owner's Team page: invite by email, change a role, remove someone, take back an invitation. Egg sends no email, so a
 * new invitation shows its link once, here: the server keeps only a hash of the token and cannot show it again.
 */
export function ProjectTeam({
  projectId,
  projectName,
  ownerName,
  members: firstMembers,
  invitations: firstInvitations,
}: {
  projectId: string;
  projectName: string;
  ownerName: string;
  members: TeamMember[];
  invitations: TeamInvitation[];
}) {
  const [members, setMembers] = useState(firstMembers);
  const [invitations, setInvitations] = useState(firstInvitations);
  // router.refresh() re-renders the server component without discarding local
  // state, so adopt the fresh props it returns after a failed role change.
  useEffect(() => setMembers(firstMembers), [firstMembers]);
  // Read once: "Expires in 6 days" is measured from the moment the page opened.
  const [now] = useState(() => Date.now());
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("viewer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const emailId = useId();
  const roleId = useId();
  const noteId = useId();

  const base = `/api/projects/${encodeURIComponent(projectId)}`;
  const open = invitations.filter((i) => isOpenInvitation(i, now));
  const full = open.length >= MAX_OPEN_INVITES;

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ invitation: TeamInvitation; token: string }>(`${base}/invitations`, {
        body: { email: email.trim(), role },
      });
      setInvitations((cur) => [res.invitation, ...cur]);
      setLink({ email: res.invitation.email, url: inviteLink(window.location.origin, res.token) });
      setEmail("");
      toast.success("Invitation created", res.invitation.email);
      requestAnimationFrame(() => {
        linkRef.current?.focus();
        linkRef.current?.select();
      });
    } catch (e) {
      setError(errorText(e, "Could not create the invitation."));
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(member: TeamMember, next: MemberRole) {
    setMembers((cur) => applyRole(cur, member.userId, next));
    try {
      await api(`${base}/members/${encodeURIComponent(member.userId)}`, { method: "PATCH", body: { role: next } });
      toast.success(`Now a ${ROLE_LABEL[next].toLowerCase()}`, member.name ?? member.email ?? undefined);
    } catch (e) {
      onRoleChangeFailed(() => router.refresh());
      toast.error("Could not change the role", errorText(e, "Try again."));
    }
  }

  async function remove(member: TeamMember) {
    await api(`${base}/members/${encodeURIComponent(member.userId)}`, { method: "DELETE" });
    setMembers((cur) => cur.filter((m) => m.userId !== member.userId));
    toast.success("Removed", member.name ?? member.email ?? undefined);
  }

  async function revoke(invitation: TeamInvitation) {
    try {
      await api(`${base}/invitations/${encodeURIComponent(invitation.id)}`, { method: "DELETE" });
      setInvitations((cur) => cur.filter((i) => i.id !== invitation.id));
      toast.success("Invitation taken back", invitation.email || undefined);
    } catch (e) {
      toast.error("Could not take it back", errorText(e, "Try again."));
    }
  }

  return (
    <>
      <PageHeader title="Team" description={`Who can see and run ${projectName}.`} />
      <div className="mx-auto w-full max-w-[720px] space-y-6">
        <Card
          id="team-invite"
          title="Invite someone"
          description={`Egg sends no email. You get a link to pass on yourself. It works once and lasts ${INVITE_DAYS} days.`}
        >
          <form onSubmit={invite} className="grid gap-4 sm:grid-cols-[1fr_11rem_auto] sm:items-end">
            <div>
              <Label htmlFor={emailId}>Email address</Label>
              <Input
                id={emailId}
                type="email"
                required
                autoComplete="off"
                inputMode="email"
                maxLength={320}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                disabled={full}
                aria-invalid={error ? true : undefined}
              />
            </div>
            <div>
              <Label htmlFor={roleId}>Role</Label>
              <NativeSelect
                id={roleId}
                value={role}
                onChange={(e) => setRole(e.target.value as MemberRole)}
                aria-describedby={noteId}
                disabled={full}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <Button type="submit" loading={busy} disabled={full || !email.trim()}>
              Create invitation
            </Button>
          </form>
          <p id={noteId} className="mt-3 text-label text-muted-foreground">
            {ROLE_NOTE[role]}
          </p>
          {full ? (
            <p className="mt-3 text-label text-muted-foreground">
              This project has {MAX_OPEN_INVITES} open invitations, the most it can have. Take one back to add another.
            </p>
          ) : null}
          {error ? (
            <Alert tone="error" role="alert" className="mt-4">
              {error}
            </Alert>
          ) : null}
          {link ? (
            <Alert tone="success" role="status" title="Send this link to them" className="mt-4">
              <p>
                It is for {link.email} and is shown only now. They sign in to Egg with the account that has this email,
                verified, and open it.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <Input ref={linkRef} readOnly value={link.url} aria-label="Invitation link" className="font-mono" />
                <CopyButton text={link.url} label="the invitation link" />
              </div>
            </Alert>
          ) : null}
        </Card>

        <Card
          id="team-people"
          title="People with access"
          description="The owner is you. Role changes and removals apply from the person's next request."
        >
          <ul className={LIST}>
            <li className={ROW}>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{ownerName} (you)</p>
                <p className="text-label text-muted-foreground">{ROLE_NOTE.owner}</p>
              </div>
              <span className="text-label text-muted-foreground">{ROLE_LABEL.owner}</span>
            </li>
            {members.map((member) => {
              const label = member.name ?? member.email ?? "Unnamed account";
              return (
                <li key={member.userId} className={ROW}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{label}</p>
                    <p className="truncate text-label text-muted-foreground">
                      {member.name && member.email ? `${member.email} · ` : ""}Joined <LocalTime iso={member.createdAt} />
                    </p>
                  </div>
                  <NativeSelect
                    className="w-32 shrink-0"
                    aria-label={`Role for ${label}`}
                    value={member.role}
                    onChange={(e) => void changeRole(member, e.target.value as MemberRole)}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </NativeSelect>
                  <ConfirmDialog
                    trigger={
                      <Button variant="outline" size="sm" aria-label={`Remove ${label}`}>
                        Remove
                      </Button>
                    }
                    title={`Remove ${label}?`}
                    description="They lose access at once. Deployments they started that have not gone live yet are canceled."
                    confirmLabel="Remove"
                    pendingLabel="Removing…"
                    tone="destructive"
                    onConfirm={() => remove(member)}
                  />
                </li>
              );
            })}
          </ul>
          {members.length === 0 ? (
            <p className="mt-3 text-label text-muted-foreground">Nobody else has access yet.</p>
          ) : null}
        </Card>

        {open.length ? (
          <Card
            id="team-open"
            title="Open invitations"
            description="Sent and not used yet. Taking one back makes its link stop working."
          >
            <ul className={LIST}>
              {open.map((invitation) => (
                <li key={invitation.id} className={ROW}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{invitation.email || "A specific account"}</p>
                    <p className="text-label text-muted-foreground">
                      {ROLE_LABEL[invitation.role]} · {expiryText(invitation.expiresAt, now)}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Take back the invitation for ${invitation.email || "this account"}`}
                    onClick={() => void revoke(invitation)}
                  >
                    Take back
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <Card id="team-roles" title="What each role can do">
          <dl className="grid gap-3 text-sm">
            {(["viewer", "developer", "owner"] as const).map((r) => (
              <div key={r} className="grid gap-0.5 sm:grid-cols-[7rem_1fr] sm:gap-4">
                <dt className="font-medium">{ROLE_LABEL[r]}</dt>
                <dd className="text-muted-foreground">{ROLE_NOTE[r]}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-label text-muted-foreground">
            Servers, credentials and deleting the project stay with the owner. An access token can never do more than the
            person who made it.
          </p>
        </Card>
      </div>
    </>
  );
}
