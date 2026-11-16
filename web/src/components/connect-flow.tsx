"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRightIcon, CheckCircleIcon } from "@phosphor-icons/react";
import { api } from "@/components/api";
import { CopyField } from "@/components/copy-field";
import { PageHeader } from "@/components/page-header";
import { DocsLink } from "@/components/settings-ui";
import { StatusIndicator } from "@/components/status-dot";
import { Alert } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ServerView } from "@/server/queries";
import { cn } from "@/lib/utils";

type TestResponse = {
  result:
    | { ok: true; issues: { level: "error" | "warning"; message: string }[] }
    | { ok: false; error: string; kind: string; hostKey?: string };
  server: ServerView;
};

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-4">
      <span
        aria-hidden="true"
        className="shadow-border-base tabular mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-[var(--ds-gray-100)] text-caption"
      >
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="font-medium tracking-[-0.02em]">{title}</h3>
        <div className="mt-2">{children}</div>
      </div>
    </li>
  );
}

function Probe({
  label,
  title,
  wrap = false,
  children,
}: {
  label: string;
  /** Full value, shown on hover when the text is cut short. */
  title?: string;
  /** Break a long unbroken value (a fingerprint) onto more lines instead of cutting it. */
  wrap?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      {/* Phones wrap every value so nothing is cut; from sm up a short value keeps one line. */}
      <dd title={title} className={cn("min-w-0 text-right", wrap ? "break-all" : "break-words sm:truncate")}>
        {children}
      </dd>
    </div>
  );
}

function ServerCard({ initial }: { initial: ServerView }) {
  const router = useRouter();
  const [server, setServer] = useState(initial);
  const [testing, setTesting] = useState(false);
  const [outcome, setOutcome] = useState<TestResponse["result"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteProjects, setDeleteProjects] = useState(false);
  /** From the page data, not the server state: the test and key routes do not return it. */
  const projectCount = initial.projectCount;

  /** With `confirmHostKey`, the owner has checked that fingerprint and agrees to trust it. */
  async function test(confirmHostKey?: string) {
    setTesting(true);
    setError(null);
    setOutcome(null);
    try {
      const res = await api<TestResponse>(`/api/servers/${server.id}/test`, {
        method: "POST",
        body: confirmHostKey ? { confirmHostKey } : undefined,
      });
      setServer(res.server);
      setOutcome(res.result);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not run the test");
    } finally {
      setTesting(false);
    }
  }

  /** Throws on failure, so the confirm dialog stays open and shows the message. */
  async function rotate() {
    const res = await api<{ server: ServerView }>(`/api/servers/${server.id}/rotate-key`, {
      method: "POST",
    });
    setServer(res.server);
    setOutcome(null);
    setError(null);
    router.refresh();
  }

  /** Throws on failure, so the confirm dialog stays open and shows the message. */
  async function remove() {
    await api(`/api/servers/${server.id}`, {
      method: "DELETE",
      body: { deleteProjects: projectCount > 0 && deleteProjects },
    });
    router.refresh();
  }

  const connected = server.status === "connected";
  const issues = server.issues;
  const pendingHostKey =
    outcome && !outcome.ok && outcome.kind === "host-key-unconfirmed" ? (outcome.hostKey ?? null) : null;
  const failure = pendingHostKey
    ? null
    : (error ?? (outcome && !outcome.ok ? outcome.error : server.lastError));
  const headingId = `server-${server.id}`;

  return (
    <section
      aria-labelledby={headingId}
      className="overflow-hidden rounded-lg bg-card shadow-border-small"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 p-5">
        <div className="min-w-0">
          <h2 id={headingId} className="truncate text-title-2">
            {server.nestUsername}.hackclub.app
          </h2>
          <div className="mt-0.5 text-muted-foreground">
            <StatusIndicator
              className="font-normal tracking-normal"
              tone={connected ? "ready" : server.status === "error" ? "error" : "neutral"}
              label={
                connected
                  ? "Connected"
                  : server.status === "error"
                    ? "Could not connect"
                    : "Waiting for the key"
              }
            />
          </div>
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
          <Button
            data-tour={connected ? undefined : "test-connection"}
            onClick={() => void test(undefined)}
            loading={testing}
            className="col-span-2 px-3 sm:col-span-1"
          >
            {testing ? "Connecting…" : "Test connection"}
          </Button>
          <ConfirmDialog
            trigger={
              <Button variant="outline" className="px-3">
                New key
              </Button>
            }
            title="Generate a new key?"
            description="The old key stops working once you remove it in the Nest dashboard, and you must add the new one."
            confirmLabel="Generate key"
            pendingLabel="Generating…"
            onConfirm={rotate}
          />
          <ConfirmDialog
            trigger={
              <Button variant="ghost" className="px-3" onClick={() => setDeleteProjects(false)}>
                Disconnect
              </Button>
            }
            tone="destructive"
            title={`Disconnect ${server.nestUsername}?`}
            description="This closes its terminals and removes our key for it. Your running apps are not touched. Remove the key from the Nest dashboard to end our access."
            confirmLabel="Disconnect"
            pendingLabel="Disconnecting…"
            onConfirm={remove}
          >
            {projectCount > 0 ? (
              <label className="mt-4 flex min-h-11 cursor-pointer items-start gap-3 rounded-lg bg-[var(--ds-gray-100)] px-3 py-2.5">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={deleteProjects}
                  onChange={(e) => setDeleteProjects(e.target.checked)}
                />
                <span className="min-w-0">
                  <span className="block font-medium">
                    {projectCount === 1
                      ? "Also delete the project on this server"
                      : `Also delete the ${projectCount} projects on this server`}
                  </span>
                  <span className="mt-0.5 block text-label text-muted-foreground">
                    {deleteProjects
                      ? "Their deployments and logs are deleted too. Their apps keep running."
                      : "Left unchecked, they are kept, and Egg stops managing them until you reconnect."}
                  </span>
                </span>
              </label>
            ) : null}
          </ConfirmDialog>
        </div>
      </div>

      {server.status !== "connected" ? (
        <div className="space-y-3 border-t px-5 py-4">
          <p className="text-muted-foreground">
            Paste this public key into the SSH Keys page of the Nest dashboard, then press Test connection.
          </p>
          <div data-tour="public-key">
            <CopyField label="Public key" value={server.publicKey} />
          </div>
          <a
            href="https://dashboard.hackclub.app"
            target="_blank"
            rel="noreferrer"
            className="touch-target link inline-flex items-center gap-1 font-medium max-sm:min-h-10"
          >
            Open the Nest dashboard
            <ArrowUpRightIcon aria-hidden="true" className="size-4" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </div>
      ) : null}

      {pendingHostKey ? (
        <div className="space-y-3 border-t p-5">
          <p className="font-medium">Confirm host key</p>
          <p className="text-muted-foreground">
            Check that this fingerprint matches the one Nest shows for {server.nestUsername}.hackclub.app, then confirm.
            Egg sends nothing to the server until you do.
          </p>
          <p
            data-tour="host-key"
            className="break-all rounded-md bg-[var(--ds-gray-100)] px-3 py-2 font-mono text-[12px]"
          >
            {pendingHostKey}
          </p>
          <Button data-tour-allow="host-key" onClick={() => void test(pendingHostKey)} loading={testing}>
            {testing ? "Confirming…" : "Confirm host key"}
          </Button>
        </div>
      ) : null}

      {failure ? (
        <div data-tour="test-failure" className="border-t p-5">
          <Alert tone="error" role="alert">
            {failure}
          </Alert>
        </div>
      ) : null}

      {connected && server.probe ? (
        <div className="motion-fade border-t px-5 py-4">
          <p className="flex items-center gap-2 font-medium">
            <CheckCircleIcon
              aria-hidden="true"
              weight="fill"
              className="size-5 text-[var(--tone-success-icon)]"
            />
            Reached your container
          </p>
          <dl className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-2 sm:grid-cols-2">
            <Probe label="System" title={server.probe.os}>
              {server.probe.os}
            </Probe>
            <Probe label="Logged in as">
              <span className="font-mono text-[13px]">
                {server.probe.uid === 0 ? "root" : `uid ${server.probe.uid}`}
              </span>
            </Probe>
            <Probe label="Node.js">
              <span className="font-mono text-[13px]">
                {server.probe.nodeVersion ?? "not installed"}
              </span>
            </Probe>
            <Probe label="Python">
              <span className="font-mono text-[13px]">
                {server.probe.pythonVersion ?? "not installed"}
              </span>
            </Probe>
            <Probe label="systemd" title={server.probe.systemdState}>
              {server.probe.systemdState}
            </Probe>
            <Probe label="Key fingerprint" wrap title={server.keyFingerprint}>
              <span className="font-mono text-[12px]">{server.keyFingerprint}</span>
            </Probe>
          </dl>
          {issues.length > 0 ? (
            <ul className="mt-4 space-y-2">
              {issues.map((i) => (
                <li key={i.message}>
                  <Alert tone={i.level === "error" ? "error" : "warning"}>{i.message}</Alert>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function ConnectFlow({ servers }: { servers: ServerView[] }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      await api("/api/servers", { body: { nestUsername: username.trim() } });
      setUsername("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the key");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="motion-enter mx-auto w-full max-w-[720px] space-y-6">
      <PageHeader
        title="Connect a Nest server"
        description="Egg signs in to your container with a key made just for it. You stay in control: removing the key in the Nest dashboard ends our access."
        actions={<DocsLink href="/docs/servers#servers-connection" topic="connecting a server" className="max-sm:hidden" />}
      />

      {servers.map((s) => (
        <ServerCard key={s.id} initial={s} />
      ))}

      <section aria-labelledby="add-heading" className="rounded-lg bg-card p-5 shadow-border-small">
        <h2 id="add-heading" className="mb-4 text-title-2">
          {servers.length === 0 ? "Add your server" : "Add another server"}
        </h2>
        <ol className="space-y-5">
          <Step n={1} title="Enter your Nest username">
            <form onSubmit={create} className="flex flex-wrap items-start gap-2">
              <div className="min-w-[220px] flex-1 max-sm:basis-full">
                <label htmlFor="nest-user" className="sr-only">
                  Nest username
                </label>
                <Input
                  data-tour="nest-username"
                  id="nest-user"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="your-nest-username"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={Boolean(error)}
                  aria-describedby="nest-user-help"
                  className="font-mono"
                />
                <p
                  id="nest-user-help"
                  role={error ? "alert" : undefined}
                  className={cn(
                    "mt-1.5 text-label",
                    error ? "text-destructive" : "text-muted-foreground"
                  )}
                >
                  {error ?? (
                    <>
                      The name you log in with, as in <code className="font-mono">ssh username@hackclub.app</code>.
                    </>
                  )}
                </p>
              </div>
              <Button
                type="submit"
                loading={creating}
                disabled={!username.trim()}
                className="px-3"
              >
                {creating ? "Creating…" : "Create key"}
              </Button>
            </form>
          </Step>
          <Step n={2} title="Add the key in the Nest dashboard">
            <p className="text-muted-foreground">The public key appears here after step 1.</p>
          </Step>
          <Step n={3} title="Test the connection">
            <p className="text-muted-foreground">Egg connects once and checks what your container can run.</p>
          </Step>
        </ol>
        <Alert tone="warning" className="mt-5">
          This key gives Egg the same access as your own login, because SSH into Nest lands in a
          root shell inside your container. Only connect a container you are happy to deploy to.
        </Alert>
      </section>
    </div>
  );
}
