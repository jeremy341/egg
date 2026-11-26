"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { api } from "@/components/api";
import { CopyField } from "@/components/copy-field";
import { Label } from "@/components/settings-ui";
import { Card } from "@/components/settings-ui";
import { Alert } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import type { DeliveryView, WebhookView } from "@/server/webhooks";

type Hook = WebhookView & { deliveries: DeliveryView[] };
type Secret = { host: string; value: string };

const EVENT_LABEL: Record<string, string> = {
  "deployment.started": "started",
  "deployment.succeeded": "succeeded",
  "deployment.failed": "failed",
  "webhook.test": "test",
};

const ERROR_TEXT: Record<string, string> = {
  blocked_address: "points at a private address",
  dns_failed: "name did not resolve",
  timeout: "timed out after 5 seconds",
  redirect: "answered with a redirect",
  network: "could not connect",
  invalid_url: "address is no longer valid",
  secret_unreadable: "secret could not be read",
  interrupted: "interrupted by a restart",
  internal: "unexpected error",
};

function errorText(code: string | null): string {
  if (!code) return "";
  const http = /^http_(\d+)$/.exec(code);
  return http ? `receiver answered ${http[1]}` : (ERROR_TEXT[code] ?? code);
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** Every control is at least 40px tall, so it is easy to hit on a phone. */
const TOUCH = "min-h-10";

function DeliveryList({ items }: { items: DeliveryView[] }) {
  if (items.length === 0) return <p className="text-label text-muted-foreground">Nothing sent yet.</p>;
  return (
    <ul className="hairline-y overflow-hidden rounded-md shadow-border-base">
      {items.map((d) => (
        <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2 text-label">
          <span className="min-w-0">
            <span className={d.status === "success" ? "font-medium" : d.status === "failed" ? "font-medium text-destructive" : "font-medium text-muted-foreground"}>
              {d.status === "success" ? "Delivered" : d.status === "failed" ? "Failed" : "Sending"}
            </span>{" "}
            <span className="text-muted-foreground">
              {EVENT_LABEL[d.event] ?? d.event}
              {d.status === "failed" && d.lastErrorCode ? `, ${errorText(d.lastErrorCode)}` : ""}
              {d.attempts > 1 ? `, ${d.attempts} attempts` : ""}
            </span>
          </span>
          <time dateTime={d.createdAt} className="shrink-0 text-muted-foreground">
            {when(d.createdAt)}
          </time>
        </li>
      ))}
    </ul>
  );
}

function HookRow({
  hook,
  onChange,
  onSecret,
  onRemoved,
}: {
  hook: Hook;
  onChange: () => void;
  onSecret: (s: Secret) => void;
  onRemoved: () => void;
}) {
  const [busy, setBusy] = useState<null | "test" | "toggle">(null);
  const base = `/api/account/webhooks/${encodeURIComponent(hook.id)}`;

  async function test() {
    setBusy("test");
    try {
      const res = await api<{ delivery: DeliveryView }>(base, { method: "POST", body: { action: "test" } });
      if (res.delivery.status === "success") toast.success("Test message delivered", hook.host);
      else toast.error("Test message failed", errorText(res.delivery.lastErrorCode) || hook.host);
    } catch (e) {
      toast.error("Could not send the test", e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(null);
      onChange();
    }
  }

  async function toggle() {
    setBusy("toggle");
    try {
      await api(base, { method: "PATCH", body: { active: !hook.active } });
      onChange();
    } catch (e) {
      toast.error("Could not change the webhook", e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-all font-medium">{hook.host}</p>
          <p className="text-label text-muted-foreground">
            {hook.active ? "On" : "Paused"} for {hook.events.map((e) => EVENT_LABEL[e]).join(", ")} deployments
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className={TOUCH} onClick={test} disabled={busy !== null} aria-label={`Send a test message to ${hook.host}`}>
            {busy === "test" ? "Sending…" : "Send test"}
          </Button>
          <Button type="button" variant="outline" className={TOUCH} onClick={toggle} disabled={busy !== null} aria-label={`${hook.active ? "Pause" : "Resume"} ${hook.host}`}>
            {hook.active ? "Pause" : "Resume"}
          </Button>
          <ConfirmDialog
            trigger={
              <Button type="button" variant="outline" className={TOUCH} aria-label={`Replace the secret for ${hook.host}`}>
                New secret
              </Button>
            }
            title="Replace the secret?"
            description="The old secret stops working right away. Your receiver must be updated with the new one."
            confirmLabel="Replace secret"
            pendingLabel="Replacing…"
            onConfirm={async () => {
              const res = await api<{ secret: string }>(base, { method: "POST", body: { action: "rotate" } });
              onSecret({ host: hook.host, value: res.secret });
              onChange();
            }}
          />
          <ConfirmDialog
            trigger={
              <Button type="button" variant="destructive" className={TOUCH} aria-label={`Delete ${hook.host}`}>
                Delete
              </Button>
            }
            tone="destructive"
            title={`Delete the webhook for ${hook.host}?`}
            description="It stops receiving messages and its delivery history is removed."
            confirmLabel="Delete"
            pendingLabel="Deleting…"
            onConfirm={async () => {
              await api(base, { method: "DELETE" });
              toast.success("Webhook deleted", hook.host);
              onRemoved();
            }}
          />
        </div>
      </div>
      <div>
        <h3 className="mb-1.5 text-label font-medium text-muted-foreground">Recent deliveries</h3>
        <DeliveryList items={hook.deliveries} />
      </div>
    </li>
  );
}

/**
 * Outbound webhooks on the Account page. The secret exists only in this
 * component's state after create or replace; it never comes back from the list.
 */
export function WebhooksCard() {
  const urlId = useId();
  const [hooks, setHooks] = useState<Hook[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [secret, setSecret] = useState<Secret | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ webhooks: Hook[] }>("/api/account/webhooks");
      setHooks(res.webhooks);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load your webhooks.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads from the server on mount
    void load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setFormError(null);
    try {
      const res = await api<{ webhook: WebhookView; secret: string }>("/api/account/webhooks", {
        method: "POST",
        body: { url: url.trim() },
      });
      setSecret({ host: res.webhook.host, value: res.secret });
      setUrl("");
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not create the webhook.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Card
      id="webhooks-heading"
      title="Webhooks"
      description="Get a signed message at an https address when a deployment starts, succeeds or fails."
    >
      <div className="space-y-4">
        {secret ? (
          <Alert tone="warning" role="status" title={`Signing secret for ${secret.host}`}>
            <p className="mb-2">Copy it now. It is shown once and cannot be read again.</p>
            <CopyField value={secret.value} label="Webhook signing secret" />
            <Button type="button" variant="outline" className={`${TOUCH} mt-3`} onClick={() => setSecret(null)}>
              I have copied it
            </Button>
          </Alert>
        ) : null}

        {loadError ? (
          <Alert
            tone="error"
            role="alert"
            action={
              <Button type="button" variant="outline" className={TOUCH} onClick={() => void load()}>
                Try again
              </Button>
            }
          >
            {loadError}
          </Alert>
        ) : hooks === null ? (
          <p className="text-muted-foreground" role="status">
            Loading webhooks…
          </p>
        ) : hooks.length === 0 ? (
          <p className="text-muted-foreground">No webhooks yet.</p>
        ) : (
          <ul className="hairline-y overflow-hidden rounded-md shadow-border-base">
            {hooks.map((h) => (
              <HookRow key={h.id} hook={h} onChange={() => void load()} onSecret={setSecret} onRemoved={() => void load()} />
            ))}
          </ul>
        )}

        <form onSubmit={create} className="space-y-1.5" noValidate>
          <Label htmlFor={urlId}>Add a webhook address</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id={urlId}
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://example.com/egg"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              aria-invalid={formError ? true : undefined}
              aria-describedby={formError ? `${urlId}-error` : `${urlId}-hint`}
              className="min-h-10 min-w-0 flex-1 basis-64"
            />
            <Button type="submit" className={TOUCH} disabled={creating || url.trim() === ""}>
              {creating ? "Adding…" : "Add webhook"}
            </Button>
          </div>
          {formError ? (
            <p id={`${urlId}-error`} role="alert" className="text-label text-destructive">
              {formError}
            </p>
          ) : (
            <p id={`${urlId}-hint`} className="text-label text-muted-foreground">
              Must be https on the standard port, with a domain name (not an IP address). It cannot point at a private network.
            </p>
          )}
        </form>

        <details className="rounded-md shadow-border-base">
          <summary className="min-h-10 cursor-pointer px-3 py-2.5 font-medium">How to check a message is from Egg</summary>
          <div className="space-y-2 px-3 pb-3 text-muted-foreground">
            <p>
              Each request has a header <code className="font-mono text-[12.5px]">X-Egg-Signature: t=1700000000,v1=…</code>. The
              part after <code className="font-mono text-[12.5px]">v1=</code> is an HMAC-SHA256 in hex, made with your secret over the
              text <code className="font-mono text-[12.5px]">timestamp.body</code>: the number after <code className="font-mono text-[12.5px]">t=</code>,
              a dot, then the raw request body.
            </p>
            <p>
              Compute it yourself, compare it to <code className="font-mono text-[12.5px]">v1</code>, and ignore the request if they differ
              or if <code className="font-mono text-[12.5px]">t</code> is more than 5 minutes old.
            </p>
            <p>
              Messages carry the event, project, deployment id, branch, short commit and state. They never carry environment values or logs.
              If your receiver does not answer with a 2xx within 5 seconds, we try up to 3 times in total.
            </p>
          </div>
        </details>
      </div>
    </Card>
  );
}
