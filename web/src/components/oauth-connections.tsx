"use client";

import { useEffect, useState } from "react";
import { api } from "@/components/api";
import { PageHeader } from "@/components/page-header";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingRegion, SkeletonCard, SkeletonText } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/** What the clients route returns. Hashes and secrets never appear here. */
export type OAuthClient = {
  id: string;
  name: string;
  clientId: string;
  redirectUris: string[];
  scopes: string[];
  createdAt: string;
};

/** Scopes are hierarchical: read < deploy < exec. The highest one wins the badge. */
const SCOPE_RANK: Record<string, number> = { "mcp:read": 1, "mcp:deploy": 2, "mcp:exec": 3 };
const SCOPE_LABEL: Record<string, string> = {
  "mcp:read": "Read",
  "mcp:deploy": "Deploy",
  "mcp:exec": "Execute",
};

const scopeLabel = (scope: string) => SCOPE_LABEL[scope] ?? scope;

function highestScope(scopes: string[]): string | null {
  return scopes.reduce<string | null>(
    (best, s) => (best === null || (SCOPE_RANK[s] ?? 0) > (SCOPE_RANK[best] ?? 0) ? s : best),
    null
  );
}

const LIST_CLASS = "hairline-y overflow-hidden rounded-lg bg-card shadow-border-small";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

/**
 * The OAuth applications area of settings. The list is read in the browser
 * from /api/oauth/clients so it can show a skeleton and a retry. Revoking asks
 * for confirmation first, then drops the row without a reload.
 */
export function OAuthConnections() {
  const [clients, setClients] = useState<OAuthClient[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    api<{ clients: OAuthClient[] }>("/api/oauth/clients")
      .then((res) => {
        if (live) setClients(res.clients);
      })
      .catch((e: unknown) => {
        if (live) setLoadError(e instanceof Error ? e.message : "Could not load your OAuth clients.");
      });
    return () => {
      live = false;
    };
  }, [attempt]);

  function retry() {
    setLoadError(null);
    setClients(null);
    setAttempt((n) => n + 1);
  }

  async function revoke(client: OAuthClient) {
    await api(`/api/oauth/clients?id=${encodeURIComponent(client.id)}`, { method: "DELETE" });
    setClients((cur) => (cur ?? []).filter((c) => c.id !== client.id));
    toast.success("OAuth client revoked", client.name);
  }

  let body: React.ReactNode;
  if (loadError) {
    body = (
      <Alert
        tone="error"
        role="alert"
        title="Could not load your OAuth clients"
        action={
          <Button type="button" variant="outline" size="sm" onClick={retry}>
            Try again
          </Button>
        }
      >
        {loadError}
      </Alert>
    );
  } else if (clients === null) {
    body = (
      <LoadingRegion label="Loading OAuth clients…">
        <SkeletonCard>
          <div className="hairline-y">
            {[0, 1, 2].map((i) => (
              <div key={i} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1.5">
                    <SkeletonText size="body" width="w-40" />
                    <SkeletonText size="caption" width="w-56" />
                  </div>
                  <SkeletonText size="label" width="w-14" />
                </div>
              </div>
            ))}
          </div>
        </SkeletonCard>
      </LoadingRegion>
    );
  } else if (clients.length === 0) {
    body = (
      <EmptyState
        title="No OAuth applications yet."
        description="When an app asks for access to your account, the applications you approve will show up here."
      />
    );
  } else {
    body = (
      <ul className={LIST_CLASS}>
        {clients.map((client) => (
          <ClientRow key={client.id} client={client} onRevoke={() => revoke(client)} />
        ))}
      </ul>
    );
  }

  return (
    <>
      <PageHeader
        title="OAuth applications"
        description="Apps you have authorized to act for you. Revoking one immediately stops its access tokens and cancels any pending authorizations."
      />
      <section aria-labelledby="oauth-clients-heading" className="min-w-0">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
          <h2 id="oauth-clients-heading" className="font-medium">
            Registered clients <span className="sr-only">: </span>
            <span className="tabular font-normal text-muted-foreground">{clients?.length ?? 0}</span>
          </h2>
        </div>
        {body}
      </section>
    </>
  );
}

function ClientRow({ client, onRevoke }: { client: OAuthClient; onRevoke: () => Promise<void> }) {
  const top = highestScope(client.scopes);
  return (
    <li className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="min-w-0 font-medium break-words">{client.name}</p>
            {top ? (
              <Badge variant="outline" className="text-caption">
                {scopeLabel(top)}
              </Badge>
            ) : null}
          </div>
          <p className="mt-0.5 font-mono text-caption text-muted-foreground">
            <span className="sr-only">Client ID </span>
            {client.clientId}
          </p>
        </div>
        <ConfirmDialog
          trigger={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Revoke ${client.name}`}
              className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              Revoke
            </Button>
          }
          tone="destructive"
          title={`Revoke "${client.name}"?`}
          description="This app will lose access right away. Its outstanding codes and tokens are cancelled. This cannot be undone."
          confirmLabel="Revoke client"
          pendingLabel="Revoking…"
          onConfirm={onRevoke}
        />
      </div>

      <dl className="mt-3 grid gap-x-4 gap-y-2.5 text-label sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-caption text-muted-foreground">Redirect URIs</dt>
          <dd className="mt-0.5">
            {client.redirectUris.length === 0 ? (
              <span className="text-muted-foreground">None</span>
            ) : (
              <ul className="min-w-0 space-y-0.5">
                {client.redirectUris.map((uri) => (
                  <li key={uri} className="font-mono text-caption break-all">
                    {uri}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-caption text-muted-foreground">Permissions</dt>
          <dd className="mt-0.5">
            {client.scopes.length === 0 ? (
              <span className="text-muted-foreground">None</span>
            ) : (
              <ul className="flex flex-wrap gap-1.5" aria-label={`Permissions of ${client.name}`}>
                {client.scopes.map((scope) => (
                  <li
                    key={scope}
                    className={cn(
                      "rounded-sm bg-muted px-1.5 py-0.5 font-mono text-caption text-muted-foreground",
                      (SCOPE_RANK[scope] ?? 0) >= 3 && "font-medium text-foreground"
                    )}
                  >
                    {scope}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
        <div className="min-w-0 sm:col-span-2">
          <dt className="text-caption text-muted-foreground">Registered</dt>
          <dd className="tabular mt-0.5">{formatDate(client.createdAt)}</dd>
        </div>
      </dl>
    </li>
  );
}
