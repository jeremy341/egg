"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { CaretRightIcon, PlusIcon, WarningIcon } from "@phosphor-icons/react";
import { api } from "@/components/api";
import { CopyButton } from "@/components/developer-docs";
import { PageHeader } from "@/components/page-header";
import { Label } from "@/components/settings-ui";
import { StatusIndicator } from "@/components/status-dot";
import { Alert } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { fieldClass, Input } from "@/components/ui/input";
import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { errorText, formatDate } from "@/lib/developer";
import { cn } from "@/lib/utils";
import type { KeySummary } from "@/server/ssh-keys";

/** A server as GET /api/servers lists it: the public part of its row. */
type ServerKey = {
  id: string;
  nestUsername: string;
  host: string;
  publicKey: string;
  keyFingerprint: string;
  status: string;
};

/** A project as GET /api/projects lists it. Only the fields the page needs. */
type ProjectEntry = { id: string; name: string; slug: string | null };

type ProjectKeyKind = "github_deploy" | "git_key";

/** Which key the create dialog makes: one of your own, or one for a project. */
type CreateTarget = { scope: "personal" } | { scope: "project"; projectId: string; projectName: string };

/** A project and its keys, rebuilt from the flat /api/keys list. */
type ProjectGroup = { projectId: string; name: string; slug: string | null; keys: KeySummary[] };

/** The key a create or rotate answered with. The private half is in state only, never stored. */
type Secret = { key: KeySummary; privateKey: string | null };

type RotateKeyResponse = { key: KeySummary; privateKey: string | null; removedFromGithub: boolean };

const KIND_LABEL: Record<KeySummary["kind"], string> = {
  github_deploy: "GitHub deploy key",
  git_key: "Git key",
  personal: "Personal key",
};

/** What revoking means for each kind. Only a deploy key touches GitHub. */
const REVOKE_NOTE: Record<KeySummary["kind"], string> = {
  github_deploy:
    "Egg removes the key from GitHub first, then revokes it here. If GitHub cannot be reached, nothing changes and the key stays active.",
  git_key: "Egg stops using this key. Its public half stays on your git host until you remove it there.",
  personal:
    "Egg marks this key as revoked. Anything outside Egg that trusts its public half keeps working until you remove it there.",
};

const KIND_OPTIONS: { value: ProjectKeyKind; label: string; note: string }[] = [
  {
    value: "github_deploy",
    label: "GitHub deploy key",
    note: "Read-only. Egg adds it to the repository through the Egg GitHub App, so you paste nothing.",
  },
  {
    value: "git_key",
    label: "Git key",
    note: "For your own git host. You paste the public half there. The private half is shown once.",
  },
];

const NAME_MAX = 60;

// Section headings are focus targets, so focus can land on them after a change removes the control.
const SERVERS_ID = "keys-servers-heading";
const PROJECTS_ID = "keys-projects-heading";
const PERSONAL_ID = "keys-personal-heading";

/** The frame every area sits in: one card, a heading and note, then its rows. */
const CARD = "overflow-hidden rounded-lg bg-card shadow-border-small";

/**
 * One project, with its keys. Built from both lists: every project of the
 * account shows up so it can get its first key, and a key whose project has
 * since vanished would still be listed, so it stays revocable.
 */
function buildGroups(projects: ProjectEntry[] | null, keys: KeySummary[]): ProjectGroup[] {
  const byProject = new Map<string, KeySummary[]>();
  for (const k of keys) {
    if (!k.projectId) continue;
    const list = byProject.get(k.projectId) ?? [];
    list.push(k);
    byProject.set(k.projectId, list);
  }
  const groups = new Map<string, ProjectGroup>();
  for (const p of projects ?? []) {
    groups.set(p.id, { projectId: p.id, name: p.name, slug: p.slug, keys: byProject.get(p.id) ?? [] });
  }
  for (const [projectId, list] of byProject) {
    if (!groups.has(projectId)) {
      groups.set(projectId, {
        projectId,
        name: list[0]?.projectName ?? "Project",
        slug: list[0]?.projectSlug ?? null,
        keys: list,
      });
    }
  }
  return [...groups.values()];
}

/** Active keys first; revoked ones are listed apart so they read as past. */
function splitByRevoked(keys: KeySummary[]) {
  return {
    active: keys.filter((k) => k.revokedAt === null),
    revoked: keys.filter((k) => k.revokedAt !== null),
  };
}

/**
 * The Keys page's working part. Three cards: the server keys Egg made for
 * each Nest account (read-only), the project keys (deploy and git keys), and
 * your personal keys. Both lists load in the browser, so they can show a
 * skeleton and a retry. A private key exists only in the create dialog's
 * state, where it is shown once; it never comes back from the list.
 */
export function KeysManager() {
  const [keys, setKeys] = useState<KeySummary[] | null>(null);
  const [keysError, setKeysError] = useState<string | null>(null);
  const [keysAttempt, setKeysAttempt] = useState(0);
  const [servers, setServers] = useState<ServerKey[] | null>(null);
  const [serversError, setServersError] = useState<string | null>(null);
  const [serversAttempt, setServersAttempt] = useState(0);
  const [projects, setProjects] = useState<ProjectEntry[] | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [projectsAttempt, setProjectsAttempt] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [target, setTarget] = useState<CreateTarget>({ scope: "personal" });

  useEffect(() => {
    let cancelled = false;
    api<{ keys: KeySummary[] }>("/api/keys")
      .then((res) => {
        if (!cancelled) setKeys(res.keys);
      })
      .catch((e) => {
        if (!cancelled) setKeysError(errorText(e, "Could not load your keys."));
      });
    return () => {
      cancelled = true;
    };
  }, [keysAttempt]);

  useEffect(() => {
    let cancelled = false;
    api<{ servers: ServerKey[] }>("/api/servers")
      .then((res) => {
        if (!cancelled) setServers(res.servers);
      })
      .catch((e) => {
        if (!cancelled) setServersError(errorText(e, "Could not load your servers."));
      });
    return () => {
      cancelled = true;
    };
  }, [serversAttempt]);

  useEffect(() => {
    let cancelled = false;
    api<{ projects: ProjectEntry[] }>("/api/projects")
      .then((res) => {
        if (!cancelled) setProjects(res.projects.map(({ id, name, slug }) => ({ id, name, slug })));
      })
      .catch((e) => {
        if (!cancelled) setProjectsError(errorText(e, "Could not load your projects."));
      });
    return () => {
      cancelled = true;
    };
  }, [projectsAttempt]);

  /** Re-reads the key list after a change. A failed read keeps the list on screen and shows the error. */
  async function reloadKeys() {
    try {
      const res = await api<{ keys: KeySummary[] }>("/api/keys");
      setKeys(res.keys);
      setKeysError(null);
    } catch (e) {
      setKeysError(errorText(e, "Could not load your keys."));
    }
  }

  async function reloadServers() {
    try {
      const res = await api<{ servers: ServerKey[] }>("/api/servers");
      setServers(res.servers);
      setServersError(null);
    } catch (e) {
      setServersError(errorText(e, "Could not load your servers."));
    }
  }

  function retryKeys() {
    setKeysError(null);
    setKeys(null);
    setKeysAttempt((n) => n + 1);
  }

  function retryServers() {
    setServersError(null);
    setServers(null);
    setServersAttempt((n) => n + 1);
  }

  function retryProjects() {
    setProjectsError(null);
    setProjects(null);
    setProjectsAttempt((n) => n + 1);
  }

  /** Focus after React has committed the change that removed the control we were on. */
  function focusHeading(id: string) {
    requestAnimationFrame(() => document.getElementById(id)?.focus());
  }

  /** Throws on failure, so the confirm dialog stays open and shows the message. */
  async function rotateServer(server: ServerKey) {
    await api<{ server: ServerKey }>(`/api/servers/${encodeURIComponent(server.id)}/rotate-key`, {
      method: "POST",
    });
    toast.success("New key made", `Paste its public key into the Nest dashboard for ${server.nestUsername}, then test the connection on Connect.`);
    await reloadServers();
  }

  /** Throws on failure, so the confirm dialog stays open and shows the message. */
  async function revoke(k: KeySummary) {
    await api(`/api/keys/${encodeURIComponent(k.id)}`, { method: "DELETE" });
    toast.success("Key revoked", k.name);
    await reloadKeys();
    focusHeading(k.kind === "personal" ? PERSONAL_ID : PROJECTS_ID);
  }

  /** Throws on failure. A deploy key is replaced on GitHub too; if the old one could not be removed, say so. */
  async function replace(k: KeySummary) {
    if (!k.projectId) return;
    const res = await api<RotateKeyResponse>(`/api/projects/${encodeURIComponent(k.projectId)}/keys/rotate`, {
      body: { kind: k.kind },
    });
    await reloadKeys();
    if (res.removedFromGithub) {
      toast.success("Deploy key replaced", k.projectName ?? k.name);
    } else {
      toast.error(
        "The old key is still on GitHub",
        "Egg could not remove it. Delete the old deploy key in the repository's settings on GitHub."
      );
    }
  }

  async function created(key: KeySummary) {
    await reloadKeys();
    toast.success(key.kind === "github_deploy" ? "Deploy key added" : "Key made", key.name);
  }

  function openPersonal() {
    setTarget({ scope: "personal" });
    setCreateOpen(true);
  }

  function openProject(group: ProjectGroup) {
    setTarget({ scope: "project", projectId: group.projectId, projectName: group.name });
    setCreateOpen(true);
  }

  const personal = keys ? splitByRevoked(keys.filter((k) => k.kind === "personal")) : null;
  // The projects list carries the ids the page needs to offer a first key to any
  // project; while it is still loading, keys alone cannot say which projects exist.
  const groups = keys === null ? [] : buildGroups(projects, keys);

  // A failed read shows here even when a list is already on screen, so a stale list never looks current.
  const serverBody = (
    <>
      {serversError ? (
        <div className="px-4 pt-4 sm:px-5">
          <Alert
            tone="error"
            role="alert"
            title="Could not load your servers"
            action={
              <Button type="button" variant="outline" size="sm" onClick={retryServers}>
                Try again
              </Button>
            }
          >
            {serversError}
          </Alert>
        </div>
      ) : null}
      {servers === null ? (
        serversError ? null : <RowsSkeleton label="Loading servers…" />
      ) : servers.length === 0 ? (
        <div className="px-4 py-4 sm:px-5">
          <EmptyState
            size="compact"
            title="Connect a server to see its key here."
            description="Each server gets its own key, made on Connect."
            action={
              <Button variant="outline" render={<Link href="/connect" />}>
                Connect a server
              </Button>
            }
          />
        </div>
      ) : (
        <ul className="hairline-y">
          {servers.map((s) => (
            <ServerRow key={s.id} server={s} onRotate={rotateServer} />
          ))}
        </ul>
      )}
    </>
  );

  const projectBody =
    keys === null || (projects === null && projectsError === null) ? (
      <RowsSkeleton label="Loading keys…" />
    ) : (
      <>
        {projectsError ? (
          <div className="px-4 pt-4 sm:px-5">
            <Alert
              tone="error"
              role="alert"
              title="Could not load your projects"
              action={
                <Button type="button" variant="outline" size="sm" onClick={retryProjects}>
                  Try again
                </Button>
              }
            >
              {projectsError}
            </Alert>
          </div>
        ) : null}
        {groups.length === 0 ? (
          projectsError ? null : (
            <div className="px-4 py-4 sm:px-5">
              <EmptyState
                size="compact"
                title="No projects yet."
                description="Every project on your account is listed here with its own Add key button."
                action={
                  <Button variant="outline" render={<Link href="/projects" />}>
                    Open Projects
                  </Button>
                }
              />
            </div>
          )
        ) : (
          groups.map((g) => {
            const { active, revoked } = splitByRevoked(g.keys);
            return (
              <div key={g.projectId} className="border-t first:border-t-0">
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 sm:px-5">
                  <h3 className="min-w-0 truncate font-medium">
                    {g.slug ? (
                      <Link href={`/projects/${encodeURIComponent(g.slug)}`} className="link">
                        {g.name}
                      </Link>
                    ) : (
                      g.name
                    )}
                  </h3>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`Add key to ${g.name}`}
                    onClick={() => openProject(g)}
                  >
                    <PlusIcon aria-hidden="true" />
                    Add key
                  </Button>
                </div>
                {active.length > 0 ? (
                  <ul className="hairline-y border-t">
                    {active.map((k) => (
                      <KeyItem
                        key={k.id}
                        k={k}
                        onRevoke={revoke}
                        onReplace={k.kind === "github_deploy" ? replace : undefined}
                      />
                    ))}
                  </ul>
                ) : (
                  <p className="border-t px-4 py-3 text-label text-muted-foreground sm:px-5">
                    No key yet. Use Add key for a GitHub deploy key or a git key for this project.
                  </p>
                )}
                {revoked.length > 0 ? (
                  <RevokedFold count={revoked.length}>
                    {revoked.map((k) => (
                      <KeyItem key={k.id} k={k} onRevoke={revoke} />
                    ))}
                  </RevokedFold>
                ) : null}
              </div>
            );
          })
        )}
      </>
    );

  const personalBody =
    personal === null ? (
      keysError ? null : <RowsSkeleton label="Loading keys…" />
    ) : personal.active.length === 0 && personal.revoked.length === 0 ? (
      <div className="px-4 py-4 sm:px-5">
        <EmptyState
          size="compact"
          title="No personal keys yet."
          description="Make one for a script, a server or a tool you use outside Egg."
        />
      </div>
    ) : (
      <>
        {personal.active.length > 0 ? (
          <ul className="hairline-y">
            {personal.active.map((k) => (
              <KeyItem key={k.id} k={k} personal onRevoke={revoke} />
            ))}
          </ul>
        ) : (
          <p className="px-4 py-4 text-muted-foreground sm:px-5">No active personal keys.</p>
        )}
        {personal.revoked.length > 0 ? (
          <RevokedFold count={personal.revoked.length}>
            {personal.revoked.map((k) => (
              <KeyItem key={k.id} k={k} personal onRevoke={revoke} />
            ))}
          </RevokedFold>
        ) : null}
      </>
    );

  return (
    <>
      <PageHeader
        title="Keys"
        description="The SSH keys Egg makes for your servers and projects, and keys you make for your own use. The public half of a key can be shared. A private key you make here is shown once."
      />
      {keysError ? (
        <Alert
          tone="error"
          role="alert"
          className="mb-6"
          title="Could not load your keys"
          action={
            <Button type="button" variant="outline" size="sm" onClick={retryKeys}>
              Try again
            </Button>
          }
        >
          {keysError}
        </Alert>
      ) : null}
      <div className="space-y-6">
        <KeyCard
          id={SERVERS_ID}
          title="Server keys"
          note="Made when you connect a server, so Egg can sign in to your Nest container. Only the public half is shown."
        >
          {serverBody}
        </KeyCard>

        <KeyCard
          id={PROJECTS_ID}
          title="Project keys"
          note="A GitHub deploy key reads one repository. A git key lets your own git host read it. Each belongs to one project."
        >
          {projectBody}
        </KeyCard>

        <KeyCard
          id={PERSONAL_ID}
          title="Personal keys"
          note="For a key you use outside Egg. The private half is shown once, when you make it."
          action={
            <Button type="button" variant="outline" size="sm" onClick={openPersonal} className="max-sm:w-full">
              <PlusIcon aria-hidden="true" />
              Generate key
            </Button>
          }
        >
          {personalBody}
        </KeyCard>
      </div>

      <KeyCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        target={target}
        onCreated={created}
      />
    </>
  );
}

/** One card per area: a heading and a short note, an optional action, then its rows. */
function KeyCard({
  id,
  title,
  note,
  action,
  children,
}: {
  id: string;
  title: string;
  note: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={CARD}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-4 pt-4 pb-3 sm:px-5">
        <div className="min-w-0">
          <h2 id={id} tabIndex={-1} className="font-medium outline-none">
            {title}
          </h2>
          <p className="mt-0.5 max-w-[64ch] text-label text-muted-foreground">{note}</p>
        </div>
        {action}
      </div>
      <div className="border-t">{children}</div>
    </section>
  );
}

function RowsSkeleton({ label }: { label: string }) {
  return (
    <LoadingRegion label={label}>
      <div className="space-y-3 px-4 py-4 sm:px-5">
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-12 w-1/2" />
      </div>
    </LoadingRegion>
  );
}

/** One server's key: which account it is for, its status, the fingerprint, and the two actions. */
function ServerRow({ server, onRotate }: { server: ServerKey; onRotate: (s: ServerKey) => Promise<void> }) {
  const name = `${server.nestUsername}@${server.host}`;
  const connected = server.status === "connected";
  return (
    <li className="px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <p className="break-all font-medium">{name}</p>
          <div className="mt-0.5 text-label text-muted-foreground">
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
          <p className="mt-1.5 font-mono text-[12px] break-all text-muted-foreground" title={server.keyFingerprint}>
            {server.keyFingerprint}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <CopyButton text={server.publicKey} label={`Copy the public key for ${name}`} className="max-sm:flex-1" />
          <ConfirmDialog
            trigger={
              <Button variant="outline" size="sm" aria-label={`New key for ${name}`} className="max-sm:flex-1">
                New key
              </Button>
            }
            title="Generate a new key?"
            description="The old key stops working once you remove it in the Nest dashboard, and you must add the new one."
            confirmLabel="Generate key"
            pendingLabel="Generating…"
            onConfirm={() => onRotate(server)}
          />
        </div>
      </div>
    </li>
  );
}

/** One key. Active keys carry their actions; revoked keys are only described, in a quiet view. */
function KeyItem({
  k,
  personal = false,
  onRevoke,
  onReplace,
}: {
  k: KeySummary;
  /** A personal key shows its own name as the title; a project key shows its kind. */
  personal?: boolean;
  onRevoke: (k: KeySummary) => Promise<void>;
  onReplace?: (k: KeySummary) => Promise<void>;
}) {
  const revokedAt = k.revokedAt;
  const onGithub = k.kind === "github_deploy" && k.installed;
  const title = personal ? k.name : KIND_LABEL[k.kind];

  return (
    <li className="px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <p className={cn("min-w-0 font-medium break-words", revokedAt && "text-muted-foreground")}>{title}</p>
            {onGithub && !revokedAt ? (
              <span className="rounded-sm bg-muted px-1.5 py-0.5 text-caption font-medium">On GitHub</span>
            ) : null}
            {revokedAt ? <StatusIndicator tone="neutral" label="Revoked" className="text-label" /> : null}
          </div>
          {personal ? null : <p className="mt-0.5 break-words text-label text-muted-foreground">{k.name}</p>}
          <p className="mt-1 font-mono text-[12px] break-all text-muted-foreground" title={k.fingerprint}>
            {k.fingerprint}
          </p>
          <p className="tabular mt-1 text-caption text-muted-foreground">
            {revokedAt ? `Revoked ${formatDate(revokedAt)}` : `Created ${formatDate(k.createdAt)}`}
          </p>
        </div>
        {revokedAt ? null : (
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <CopyButton text={k.publicKey} label={`Copy the public key for ${k.name}`} className="max-sm:flex-1" />
            {onReplace ? (
              <ConfirmDialog
                trigger={
                  <Button variant="outline" size="sm" aria-label={`Replace key for ${k.name}`} className="max-sm:flex-1">
                    Replace key
                  </Button>
                }
                title="Replace this deploy key?"
                description="Egg makes a new read-only key, installs it on GitHub and removes the old one there."
                confirmLabel="Replace key"
                pendingLabel="Replacing…"
                onConfirm={() => onReplace(k)}
              />
            ) : null}
            <ConfirmDialog
              trigger={
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Revoke ${k.name}`}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive max-sm:flex-1"
                >
                  Revoke
                </Button>
              }
              tone="destructive"
              title={`Revoke "${k.name}"?`}
              description={REVOKE_NOTE[k.kind]}
              confirmLabel="Revoke key"
              pendingLabel="Revoking…"
              onConfirm={() => onRevoke(k)}
            />
          </div>
        )}
      </div>
    </li>
  );
}

/** Revoked keys, folded away the way the token list folds them. */
function RevokedFold({ count, children }: { count: number; children: React.ReactNode }) {
  return (
    <details className="disclosure border-t">
      <summary className="touch-target transition-colors duration-(--dur-fast) ease-snappy min-h-10 items-center gap-2 px-4 py-2.5 font-medium text-muted-foreground select-none hover:text-foreground sm:min-h-8 sm:px-5">
        <CaretRightIcon aria-hidden="true" className="disclosure-caret size-3.5 motion-reduce:transition-none" />
        Revoked
        <span className="tabular font-normal">{count}</span>
      </summary>
      <ul className="hairline-y border-t">{children}</ul>
    </details>
  );
}

/**
 * The create flow for a personal key or a project key, in one dialog. It stays
 * open after creating so the one-time key can be copied. Rotating a deploy key
 * is not here; that is the Replace key action on its row.
 */
function KeyCreateDialog({
  open,
  onOpenChange,
  target,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: CreateTarget;
  onCreated: (key: KeySummary) => Promise<void>;
}) {
  const uid = useId();
  const kindName = `${uid}-kind`;
  const nameId = `${uid}-name`;
  const nameHintId = `${uid}-name-hint`;
  const nameErrId = `${uid}-name-error`;
  const nameRef = useRef<HTMLInputElement>(null);

  const [kind, setKind] = useState<ProjectKeyKind>("github_deploy");
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [secret, setSecret] = useState<Secret | null>(null);

  const project = target.scope === "project" ? target : null;
  const personal = project === null;

  function reset() {
    setSecret(null);
    setName("");
    setNameError(null);
    setServerError(null);
    setKind("github_deploy");
  }

  function handleOpenChange(next: boolean) {
    // Once a private key is on screen the dialog stays open, so a stray Esc cannot lose it.
    if (!next && secret?.privateKey) return;
    if (!next) reset();
    onOpenChange(next);
  }

  function finish() {
    reset();
    onOpenChange(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setServerError(null);
    const trimmed = name.trim();
    if (personal && !trimmed) {
      setNameError("Give the key a name.");
      nameRef.current?.focus();
      return;
    }
    setNameError(null);

    setPending(true);
    try {
      if (project === null) {
        const res = await api<{ key: KeySummary; privateKey: string }>("/api/keys", {
          body: { name: trimmed },
        });
        setSecret({ key: res.key, privateKey: res.privateKey });
        await onCreated(res.key);
      } else {
        // Only a git key takes a name; a deploy key is named after its project.
        const body = kind === "git_key" && trimmed ? { kind, name: trimmed } : { kind };
        const res = await api<{ key: KeySummary; privateKey: string | null }>(
          `/api/projects/${encodeURIComponent(project.projectId)}/keys`,
          { body }
        );
        setSecret({ key: res.key, privateKey: res.privateKey });
        await onCreated(res.key);
      }
    } catch (err) {
      setServerError(errorText(err, "Could not make the key. Try again."));
    } finally {
      setPending(false);
    }
  }

  const title = secret
    ? secret.privateKey
      ? "Your new key"
      : "Deploy key added"
    : project
      ? `Add a key to ${project.projectName}`
      : "Generate a personal key";

  const description = secret
    ? secret.privateKey
      ? "Copy it now. It is shown once."
      : null
    : personal
      ? "A key for your own use outside Egg. Its private half is shown once, here, and cannot be shown again."
      : "Pick the kind of key. You can revoke it later from this page.";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="lg">
        <div className="border-b px-5 py-4">
          <DialogTitle className="text-title-3">{title}</DialogTitle>
          {description ? <DialogDescription className="mt-1 text-label">{description}</DialogDescription> : null}
        </div>
        {secret ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <OneTimeKey secret={secret} onDone={finish} />
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">
              {project ? (
                <fieldset className="min-w-0">
                  <legend className="mb-2 text-label text-muted-foreground">Kind</legend>
                  <div className="space-y-2">
                    {KIND_OPTIONS.map((o) => (
                      <label
                        key={o.value}
                        className={cn(
                          "flex min-h-11 cursor-pointer items-start gap-3 rounded-md px-3 py-2.5 shadow-border-base",
                          kind === o.value && "bg-muted/60"
                        )}
                      >
                        <input
                          type="radio"
                          name={kindName}
                          value={o.value}
                          checked={kind === o.value}
                          onChange={() => setKind(o.value)}
                          className="mt-1 shrink-0"
                        />
                        <span className="min-w-0">
                          <span className="block font-medium">{o.label}</span>
                          <span className="mt-0.5 block text-label text-muted-foreground">{o.note}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : null}

              {personal || kind === "git_key" ? (
                <div>
                  <Label htmlFor={nameId}>{personal ? "Name" : "Name (optional)"}</Label>
                  <Input
                    id={nameId}
                    ref={nameRef}
                    value={name}
                    maxLength={NAME_MAX}
                    required={personal}
                    aria-required={personal ? "true" : undefined}
                    aria-invalid={nameError ? true : undefined}
                    aria-describedby={nameError ? `${nameHintId} ${nameErrId}` : nameHintId}
                    autoComplete="off"
                    onChange={(e) => {
                      setName(e.target.value);
                      setNameError(null);
                    }}
                    className="sm:max-w-sm"
                  />
                  <p id={nameHintId} className="mt-1.5 text-caption text-muted-foreground">
                    So you can tell it apart later, for example laptop or work-host. Up to {NAME_MAX} characters.
                  </p>
                  {nameError ? (
                    <p id={nameErrId} role="alert" className="mt-1 text-label text-destructive">
                      {nameError}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {serverError ? (
                <Alert tone="error" role="alert">
                  {serverError}
                </Alert>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t px-5 py-3">
              <Button type="submit" loading={pending} className="max-sm:w-full">
                {pending ? (personal ? "Generating…" : "Adding…") : personal ? "Generate key" : "Add key"}
              </Button>
              <DialogClose render={<Button type="button" variant="ghost" className="max-sm:w-full" />}>
                Cancel
              </DialogClose>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The one-time view of a new key. A private key comes with the public key and
 * the shown-once warning. A GitHub deploy key has no private half: it is on
 * GitHub already, so only the public key is shown.
 */
function OneTimeKey({ secret, onDone }: { secret: Secret; onDone: () => void }) {
  const headingId = useId();
  const noteId = useId();
  const uid = useId();
  const { key, privateKey } = secret;

  return (
    <div
      role="region"
      aria-labelledby={headingId}
      aria-live="polite"
      className={cn(
        "rounded-lg p-4",
        privateKey
          ? "bg-[var(--tone-warning-bg)] shadow-[0_0_0_1px_var(--tone-warning-ring)]"
          : "bg-muted/40 shadow-border-base"
      )}
    >
      <h3 id={headingId} className="flex items-start gap-2 font-medium">
        {privateKey ? (
          <WarningIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--tone-warning-icon)]" />
        ) : null}
        <span className="min-w-0 break-words">{privateKey ? `New key: ${key.name}` : "Deploy key added"}</span>
      </h3>

      {privateKey ? (
        <>
          <p id={noteId} className="mt-1 font-medium">
            The private key is shown only once. Copy it now and keep it somewhere safe.
          </p>
          <div className="mt-4 space-y-4">
            <ReadOnlyKey
              id={`${uid}-private`}
              label="Private key"
              value={privateKey}
              multiline
              autoFocus
              describedBy={noteId}
            />
            <ReadOnlyKey id={`${uid}-public`} label="Public key" value={key.publicKey} />
          </div>
        </>
      ) : (
        <>
          <p id={noteId} className="mt-1">
            Added to GitHub automatically. Egg installed this read-only key on the repository, so there is nothing to
            paste.
          </p>
          <div className="mt-4">
            <ReadOnlyKey id={`${uid}-public`} label="Public key" value={key.publicKey} describedBy={noteId} autoFocus />
          </div>
        </>
      )}

      <div className="mt-4">
        <Button type="button" onClick={onDone} className="max-sm:w-full">
          {privateKey ? "I have copied it" : "Done"}
        </Button>
      </div>
    </div>
  );
}

/** A key shown read-only with its own copy button. Selected on focus so a manual copy works too. */
function ReadOnlyKey({
  id,
  label,
  value,
  multiline = false,
  autoFocus = false,
  describedBy,
}: {
  id: string;
  label: string;
  value: string;
  multiline?: boolean;
  autoFocus?: boolean;
  describedBy?: string;
}) {
  useEffect(() => {
    if (!autoFocus) return;
    const frame = requestAnimationFrame(() => document.getElementById(id)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [autoFocus, id]);

  const selectField = () => (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null)?.select();
  const common = {
    id,
    readOnly: true,
    value,
    spellCheck: false,
    autoComplete: "off" as const,
    "aria-describedby": describedBy,
    onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => e.currentTarget.select(),
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {multiline ? (
        <textarea
          {...common}
          rows={5}
          className={cn(fieldClass, "h-auto resize-y py-2 font-mono text-[13px] break-all md:text-[13px]")}
        />
      ) : (
        <input {...common} className={cn(fieldClass, "min-w-0 font-mono text-[13px] md:text-[13px]")} />
      )}
      <CopyButton text={value} label={`Copy the ${label.toLowerCase()}`} onFail={selectField} className="max-sm:w-full" />
    </div>
  );
}
