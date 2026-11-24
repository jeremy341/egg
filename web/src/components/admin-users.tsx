"use client";

import { useEffect, useState } from "react";
import { api } from "@/components/api";
import { PageHeader } from "@/components/page-header";
import { Label } from "@/components/settings-ui";
import { StatusIndicator } from "@/components/status-dot";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, fieldClass } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type UserRow = {
  id: string;
  name: string;
  hackClubId: string;
  email: string | null;
  administrator: boolean;
  standing: "active" | "grace" | "blocked";
  createdAt: string;
};

type Detail = {
  user: { id: string; name: string; hackClubId: string; email: string | null; createdAt: string; suspensionReason: string | null };
  standing: { state: "active" | "grace" | "blocked"; graceEndsAt: string | null };
  administrator: boolean;
  configuredAdministrator: boolean;
  history: { id: number; label: string; at: string; actor: string; reason: string | null }[];
};

const REASON_MIN = 5;
const CARD = "overflow-hidden rounded-lg bg-card shadow-border-small";
const REAUTH_HREF = `/api/auth/reauth?next=${encodeURIComponent("/admin/users")}`;

function day(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

const STANDING_LABEL = { active: "Active", grace: "Banned, in grace", blocked: "Banned, writes blocked" } as const;
const STANDING_TONE = { active: "neutral", grace: "warning", blocked: "error" } as const;

/** Find an account, read its standing and history, and act on it. Every action is checked again on the server. */
export function AdminUsers() {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");

  // Search as the person types. A response for an older search is ignored.
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      api<{ users: UserRow[] }>(`/api/admin/users?q=${encodeURIComponent(query)}`)
        .then((data) => alive && setUsers(data.users))
        .catch((err: unknown) => alive && setError(err instanceof Error ? err.message : "Could not search accounts."));
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query]);

  async function loadDetail(id: string) {
    setSelected(id);
    setDetail(null);
    setReason("");
    setError(null);
    setNotice(null);
    try {
      setDetail(await api<Detail>(`/api/admin/users/${encodeURIComponent(id)}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open this account.");
    }
  }

  /** A ban, a lift or an administrator change needs a fresh Hack Club sign-in. Send the person there. */
  function needsSignIn(err: unknown): boolean {
    if (err instanceof Error && (err as Error & { code?: string }).code === "reauth_required") {
      window.location.assign(REAUTH_HREF);
      return true;
    }
    return false;
  }

  async function act(path: string, body: unknown, done: string) {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api(`/api/admin/users/${encodeURIComponent(selected)}${path}`, { method: path === "/administrator" ? "PUT" : "POST", body });
      setNotice(done);
      setReason("");
      await loadDetail(selected);
    } catch (err) {
      if (!needsSignIn(err)) setError(err instanceof Error ? err.message : "The change did not go through.");
    } finally {
      setBusy(false);
    }
  }

  const reasonOk = reason.trim().length >= REASON_MIN;

  return (
    <div className="motion-enter space-y-6">
      <PageHeader
        title="Accounts"
        description="Find an account by name or Hack Club ID. Bans give the account 15 days of normal use, then block its writes. Reads and exports keep working."
      />

      {error ? (
        <Alert tone="error" role="alert">
          {error}
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <section aria-labelledby="accounts-heading" className={CARD}>
          <div className="border-b px-4 py-3">
            <h2 id="accounts-heading" className="text-title-3">
              Accounts
            </h2>
            <div className="mt-3">
              <Label htmlFor="account-search">Find an account</Label>
            </div>
            <Input
              id="account-search"
              type="search"
              autoComplete="off"
              placeholder="Name or Hack Club ID"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {users === null ? (
            <p className="px-4 py-5 text-muted-foreground">Loading accounts…</p>
          ) : users.length === 0 ? (
            <p className="px-4 py-5 text-muted-foreground">No account matches that search.</p>
          ) : (
            <ul className="hairline-y max-h-[60vh] overflow-y-auto">
              {users.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => void loadDetail(u.id)}
                    aria-current={selected === u.id ? "true" : undefined}
                    className={cn(
                      "flex w-full flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-left hover:bg-background-subtle",
                      selected === u.id && "bg-background-subtle"
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{u.name}</span>
                      <span className="block truncate font-mono text-caption font-normal text-muted-foreground">{u.hackClubId}</span>
                    </span>
                    <span className="flex flex-wrap gap-2 text-caption font-normal">
                      {u.administrator ? <span className="rounded-sm bg-background-subtle px-1.5 py-0.5">Administrator</span> : null}
                      {u.standing !== "active" ? (
                        <StatusIndicator tone={STANDING_TONE[u.standing]} label={STANDING_LABEL[u.standing]} />
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="account-heading" className={CARD}>
          <div className="border-b px-4 py-3">
            <h2 id="account-heading" className="text-title-3">
              Account details
            </h2>
          </div>
          {!selected ? (
            <p className="px-4 py-5 text-muted-foreground">Choose an account to see its status and history.</p>
          ) : !detail ? (
            <p className="px-4 py-5 text-muted-foreground">Loading account…</p>
          ) : (
            <div className="space-y-5 p-4">
              <div>
                <p className="text-title-3">{detail.user.name}</p>
                <p className="font-mono text-caption text-muted-foreground">{detail.user.hackClubId}</p>
                {detail.user.email ? <p className="text-label text-muted-foreground">{detail.user.email}</p> : null}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <StatusIndicator tone={STANDING_TONE[detail.standing.state]} label={STANDING_LABEL[detail.standing.state]} />
                {detail.standing.graceEndsAt && detail.standing.state === "grace" ? (
                  <span className="text-label text-muted-foreground">Writes stop on {day(detail.standing.graceEndsAt)}</span>
                ) : null}
                {detail.standing.graceEndsAt && detail.standing.state === "blocked" ? (
                  <span className="text-label text-muted-foreground">Writes blocked since {day(detail.standing.graceEndsAt)}</span>
                ) : null}
              </div>

              {detail.user.suspensionReason && detail.standing.state !== "active" ? (
                <p className="text-label">
                  <span className="text-muted-foreground">Reason: </span>
                  {detail.user.suspensionReason}
                </p>
              ) : null}

              {notice ? (
                <Alert tone="success" role="status">
                  {notice}
                </Alert>
              ) : null}

              {detail.configuredAdministrator ? (
                <p className="text-label text-muted-foreground">This is the account set in the server settings. It cannot be banned or changed here.</p>
              ) : (
                <div className="space-y-4 border-t pt-4">
                  {detail.standing.state === "active" && !detail.administrator ? (
                    <div>
                      <Label htmlFor="ban-reason">Reason for the ban</Label>
                      <textarea
                        id="ban-reason"
                        value={reason}
                        maxLength={500}
                        onChange={(e) => setReason(e.target.value)}
                        className={cn(fieldClass, "h-auto min-h-20 resize-y py-2 max-sm:h-auto")}
                        placeholder="Shown in the audit log. The account keeps working for 15 days."
                      />
                      <div className="mt-2">
                        <ConfirmDialog
                          trigger={
                            <Button type="button" variant="destructive" disabled={busy || !reasonOk}>
                              Ban account
                            </Button>
                          }
                          tone="destructive"
                          title="Ban this account?"
                          description="It keeps working for 15 days, with a banner showing the end date. After that, new projects, deployments, settings changes, security reports and API writes are blocked."
                          confirmLabel="Ban account"
                          pendingLabel="Banning…"
                          onConfirm={() => act("/ban", { reason }, "The account is banned. Its 15-day grace period has started.")}
                        />
                      </div>
                    </div>
                  ) : null}

                  {detail.standing.state !== "active" ? (
                    <div>
                      <Label htmlFor="lift-reason">Reason for lifting the ban</Label>
                      <textarea
                        id="lift-reason"
                        value={reason}
                        maxLength={500}
                        onChange={(e) => setReason(e.target.value)}
                        className={cn(fieldClass, "h-auto min-h-20 resize-y py-2 max-sm:h-auto")}
                        placeholder="Shown in the audit log next to the ban reason."
                      />
                      <div className="mt-2">
                        <Button type="button" variant="outline" disabled={busy || !reasonOk} onClick={() => void act("/unban", { reason }, "The ban is lifted.")}>
                          Lift ban
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  <div>
                    {detail.administrator ? (
                      <ConfirmDialog
                        trigger={
                          <Button type="button" variant="outline" disabled={busy}>
                            Remove administration
                          </Button>
                        }
                        tone="destructive"
                        title={`Remove administration from ${detail.user.name}?`}
                        description="They keep their account but lose access to administration at once."
                        confirmLabel="Remove"
                        pendingLabel="Removing…"
                        onConfirm={() => act("/administrator", { administrator: false }, "Administration removed.")}
                      />
                    ) : detail.standing.state === "active" ? (
                      <Button type="button" variant="outline" disabled={busy} onClick={() => void act("/administrator", { administrator: true }, "The account is now an administrator.")}>
                        Make administrator
                      </Button>
                    ) : null}
                  </div>
                </div>
              )}

              <div className="border-t pt-4">
                <h3 className="text-label font-medium">History</h3>
                {detail.history.length === 0 ? (
                  <p className="mt-2 text-label text-muted-foreground">No bans or administrator changes for this account.</p>
                ) : (
                  <ul className="mt-2 divide-y">
                    {detail.history.map((h) => (
                      <li key={h.id} className="py-2.5">
                        <p className="text-label">
                          <span className="font-medium">{h.label}</span> by {h.actor}
                        </p>
                        {h.reason ? <p className="text-caption text-muted-foreground">Reason: {h.reason}</p> : null}
                        <time dateTime={h.at} className="tabular font-mono text-caption text-muted-foreground">
                          {new Date(h.at).toLocaleString()}
                        </time>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
