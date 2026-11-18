"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/components/api";
import { Card, Label } from "@/components/settings-ui";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";

type Admin = { userId: string; name: string | null; email: string | null };
type Listing = { configured: Admin | null; granted: (Admin & { grantedAt: string })[] };

const REAUTH_HREF = `/api/auth/reauth?next=${encodeURIComponent("/admin#administrators-heading")}`;

/** Who administers this instance. Only an administrator sees this card, and each change needs a fresh sign-in. */
export function AdminAdministrators() {
  const [listing, setListing] = useState<Listing | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setListing(await api<Listing>("/api/admin/admins"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load administrators.");
    }
  }, []);

  // The first load ignores a response that arrives after the card has unmounted.
  useEffect(() => {
    let alive = true;
    api<Listing>("/api/admin/admins")
      .then((data) => {
        if (alive) setListing(data);
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : "Could not load administrators.");
      });
    return () => {
      alive = false;
    };
  }, []);

  /** A change needs a fresh Hack Club sign-in. Send the person there and bring them back to this card. */
  function needsSignIn(err: unknown): boolean {
    if (err instanceof Error && (err as Error & { code?: string }).code === "reauth_required") {
      window.location.assign(REAUTH_HREF);
      return true;
    }
    return false;
  }

  async function grant(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api<{ name: string; changed: boolean }>("/api/admin/admins", {
        method: "POST",
        body: { email },
      });
      setNotice(res.changed ? `${res.name} is now an administrator.` : `${res.name} already administers this instance.`);
      setEmail("");
      await load();
    } catch (err) {
      if (!needsSignIn(err)) setError(err instanceof Error ? err.message : "Could not grant administration.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(userId: string) {
    setError(null);
    setNotice(null);
    try {
      await api("/api/admin/admins", { method: "DELETE", body: { userId } });
      setNotice("Administration removed.");
      await load();
    } catch (err) {
      if (needsSignIn(err)) return;
      setError(err instanceof Error ? err.message : "Could not remove administration.");
    }
  }

  return (
    <Card
      id="administrators-heading"
      title="Administrators"
      description="Administrators can open the security inbox, this page and maintenance settings. Granting needs a verified email and a fresh Hack Club sign-in."
    >
      {listing ? (
        <ul className="hairline-y overflow-hidden rounded-md shadow-border-base">
          {listing.configured ? (
            <li className="flex items-center justify-between gap-3 px-3 py-2.5">
              <span className="min-w-0 truncate">
                <span className="font-medium">{listing.configured.name ?? "Configured account"}</span>
                <span className="ml-2 text-label text-muted-foreground">Set in the server settings. Cannot be removed here.</span>
              </span>
            </li>
          ) : null}
          {listing.granted.map((a) => (
            <li key={a.userId} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <span className="min-w-0 truncate">
                <span className="font-medium">{a.name ?? "Unnamed account"}</span>
                {a.email ? <span className="ml-2 text-label text-muted-foreground">{a.email}</span> : null}
              </span>
              <ConfirmDialog
                trigger={
                  <Button type="button" variant="outline" size="sm" aria-label={`Remove administration from ${a.name ?? "this account"}`}>
                    Remove
                  </Button>
                }
                tone="destructive"
                title={`Remove administration from ${a.name ?? "this account"}?`}
                description="They keep their account but lose access to administration at once."
                confirmLabel="Remove"
                pendingLabel="Removing…"
                onConfirm={() => remove(a.userId)}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">Loading administrators…</p>
      )}

      <form onSubmit={grant} className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <Label htmlFor="admin-grant-email">Make an administrator</Label>
          <Input
            id="admin-grant-email"
            type="email"
            autoComplete="off"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <p className="mt-1 text-label text-muted-foreground">
            The account must have signed in with this email and verified it.
          </p>
        </div>
        <Button type="submit" disabled={busy || !email.trim()} loading={busy}>
          Grant administration
        </Button>
      </form>

      {notice ? (
        <Alert tone="success" role="status" className="mt-3">
          {notice}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="error" role="alert" className="mt-3">
          {error}
        </Alert>
      ) : null}
    </Card>
  );
}
