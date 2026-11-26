"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CaretDownIcon, CaretRightIcon, PlusIcon, WarningIcon } from "@phosphor-icons/react";
import { api } from "@/components/api";
import { CopyButton } from "@/components/developer-docs";
import { PageHeader } from "@/components/page-header";
import { Label } from "@/components/settings-ui";
import { TokenListSkeleton } from "@/components/skeletons/developer";
import { StatusIndicator } from "@/components/status-dot";
import { Alert } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { fieldClass, Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { LoadingRegion } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import {
  ACTIVE_TOKEN_LIMIT,
  DEFAULT_EXPIRY_DAYS,
  DEPLOY_DROP_NOTE,
  NAME_MAX_LENGTH,
  SECRET_NOTE,
  SHORT_LIVED_NOTE,
  STATUS_LABEL,
  activeCount,
  allowedExpiries,
  buildTokenPatch,
  canEdit,
  clampEditExpiry,
  clampExpiry,
  dropsDeployAccess,
  errorText,
  expiryLabel,
  formatDate,
  holdsShortLived,
  isChangeScope,
  lastUsedLabel,
  limitNote,
  scopeBadge,
  scopeNote,
  tokenStatus,
  type ExpiryChoice,
  type TokenPatch,
} from "@/lib/developer";
import { EXPIRING_SOON_DAYS, groupTokens } from "@/lib/developer-groups";
import { cn } from "@/lib/utils";
import type { TokenSummary } from "@/server/api-tokens";

export type ScopeOption = { id: string; label: string };

// Amber is kept for "Expires soon", the one state that asks for action.
const TONE_FOR = { active: "ready", expired: "neutral", revoked: "neutral" } as const;

type Secret = { name: string; value: string };

/** The frame every token list sits in: one card, a hairline between rows. */
const LIST_CLASS = "hairline-y overflow-hidden rounded-lg bg-card shadow-border-small";

/**
 * The Developer page's working part: the page header with "Create token", the
 * create dialog with the one-time secret, and the list grouped by status
 * (Active, Expired, then Revoked folded away). `aside` is the right-hand
 * column. The list loads in the browser from /api/tokens so it can show a
 * skeleton and a retry. The secret exists only in this component's state: it
 * is never stored and never comes back from the list.
 */
export function DeveloperTokens({ scopes, aside }: { scopes: ScopeOption[]; aside?: React.ReactNode }) {
  const [tokens, setTokens] = useState<TokenSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [secret, setSecret] = useState<Secret | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const secretRef = useRef<HTMLInputElement>(null);
  const listHeadingRef = useRef<HTMLHeadingElement>(null);
  // Computed once: statuses and "in 12 days" are read against this moment.
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    api<{ tokens: TokenSummary[] }>("/api/tokens")
      .then((res) => {
        if (!cancelled) setTokens(res.tokens);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(errorText(e, "Could not load your tokens."));
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  /** Focus after React has committed the change that put the target on screen. */
  const focusSoon = (target: "secret" | "list") =>
    requestAnimationFrame(() => {
      if (target === "secret") {
        secretRef.current?.focus();
        secretRef.current?.select();
      } else {
        listHeadingRef.current?.focus();
      }
    });

  function retry() {
    setLoadError(null);
    setTokens(null);
    setAttempt((n) => n + 1);
  }

  function onCreated(token: TokenSummary, value: string) {
    setTokens((cur) => [token, ...(cur ?? [])]);
    setSecret({ name: token.name, value });
    focusSoon("secret");
    toast.success("Token created", token.name);
  }

  async function revoke(token: TokenSummary) {
    await api(`/api/tokens/${encodeURIComponent(token.id)}`, { method: "DELETE" });
    setTokens((cur) =>
      (cur ?? []).map((t) =>
        t.id === token.id ? { ...t, revokedAt: new Date().toISOString(), active: false } : t
      )
    );
    toast.success("Token revoked", token.name);
    focusSoon("list");
  }

  /** Throws the server's message so the editor can show it inline. */
  async function save(token: TokenSummary, patch: TokenPatch) {
    const res = await api<{ token: TokenSummary }>(`/api/tokens/${encodeURIComponent(token.id)}`, {
      method: "PATCH",
      body: patch,
    });
    setTokens((cur) => (cur ?? []).map((t) => (t.id === token.id ? res.token : t)));
    toast.success("Token updated", res.token.name);
  }

  const active = tokens ? activeCount(tokens, now) : 0;
  const atLimit = active >= ACTIVE_TOKEN_LIMIT;
  const groups = groupTokens(tokens ?? [], now);
  const canCreate = tokens !== null && !atLimit;
  const openCreate = () => setCreateOpen(true);

  let body: React.ReactNode;
  // Empty and error states get the same heading row as the groups, so both columns start level.
  const plainHeading = (
    <h2 id="tokens-heading" className="mb-2 font-medium">
      Access tokens
    </h2>
  );
  if (loadError) {
    body = (
      <>
        {plainHeading}
        <Alert
          tone="error"
          role="alert"
          title="Could not load your tokens"
          action={
            <Button type="button" variant="outline" size="sm" onClick={retry}>
              Try again
            </Button>
          }
        >
          {loadError}
        </Alert>
      </>
    );
  } else if (tokens === null) {
    body = (
      <LoadingRegion label="Loading tokens…">
        <TokenListSkeleton />
      </LoadingRegion>
    );
  } else if (tokens.length === 0) {
    body = (
      <>
        {plainHeading}
        <EmptyState
          title="Create a token to let a script or an AI agent use the API."
          action={
            <Button type="button" variant="outline" onClick={openCreate}>
              <PlusIcon aria-hidden="true" />
              Create token
            </Button>
          }
        />
      </>
    );
  } else {
    const soon = groups.expiringSoon;
    body = (
      <div className="space-y-8">
        <section aria-labelledby="tokens-active-heading">
          <GroupHeading id="tokens-active-heading" headingRef={listHeadingRef} title="Active" count={groups.active.length}>
            {soon > 0 ? (
              <>
                <span className="text-foreground">
                  {soon} {soon === 1 ? "expires" : "expire"} within {EXPIRING_SOON_DAYS} days
                </span>
                <span aria-hidden="true"> · </span>
                <span className="sr-only">, </span>
              </>
            ) : null}
            {active} of {ACTIVE_TOKEN_LIMIT} in use
          </GroupHeading>
          {atLimit ? (
            <Alert tone="warning" className="mb-3 p-3 text-label">
              {limitNote(active)}
            </Alert>
          ) : null}
          {groups.active.length > 0 ? (
            <ul className={LIST_CLASS}>
              {groups.active.map(({ token: t, expiringSoon }) => (
                <TokenRow
                  key={t.id}
                  token={t}
                  now={now}
                  scopes={scopes}
                  expiringSoon={expiringSoon}
                  onRevoke={() => revoke(t)}
                  onSave={save}
                />
              ))}
            </ul>
          ) : (
            <p className="rounded-lg bg-card px-4 py-3 text-muted-foreground shadow-border-small">
              No active tokens. Anything that used the ones below has stopped working.
            </p>
          )}
        </section>

        {groups.expired.length > 0 ? (
          <section aria-labelledby="tokens-expired-heading">
            <GroupHeading id="tokens-expired-heading" title="Expired" count={groups.expired.length}>
              An expired token cannot be renewed
            </GroupHeading>
            <ul className={LIST_CLASS}>
              {groups.expired.map((t) => (
                <TokenRow key={t.id} token={t} now={now} scopes={scopes} onRevoke={() => revoke(t)} onSave={save} />
              ))}
            </ul>
          </section>
        ) : null}

        {groups.revoked.length > 0 ? (
          <details className="disclosure">
            <summary className="touch-target transition-colors duration-(--dur-fast) ease-snappy -ml-1 min-h-10 items-center gap-2 rounded-md px-1 font-medium text-muted-foreground select-none hover:text-foreground sm:min-h-8">
              <CaretRightIcon aria-hidden="true" className="disclosure-caret size-3.5 motion-reduce:transition-none" />
              Revoked
              <span className="tabular font-normal">{groups.revoked.length}</span>
            </summary>
            <ul className={cn(LIST_CLASS, "mt-2")}>
              {groups.revoked.map((t) => (
                <TokenRow key={t.id} token={t} now={now} scopes={scopes} onRevoke={() => revoke(t)} onSave={save} />
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Developer"
        description="Tokens let a script or an AI agent act for you, with only the permissions you pick. Treat each one like a password."
        actions={
          <Button type="button" disabled={!canCreate} onClick={openCreate} className="max-sm:w-full">
            <PlusIcon aria-hidden="true" />
            Create token
          </Button>
        }
      />
      <TokenCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        scopes={scopes}
        disabled={!canCreate}
        limitReached={atLimit}
        secret={secret}
        secretRef={secretRef}
        onCreated={onCreated}
        onSecretDone={() => {
          setSecret(null);
          setCreateOpen(false);
          focusSoon("list");
        }}
      />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-6">
        <section aria-label="Access tokens" className="min-w-0">
          {body}
        </section>
        {aside}
      </div>
    </>
  );
}

/** A group's title and count on the left, a short note on the right. */
function GroupHeading({
  id,
  title,
  count,
  headingRef,
  children,
}: {
  id: string;
  title: string;
  count: number;
  headingRef?: React.Ref<HTMLHeadingElement>;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
      <h2 id={id} ref={headingRef} tabIndex={headingRef ? -1 : undefined} className="font-medium outline-none">
        {title} <span className="sr-only">tokens: </span>
        <span className="tabular font-normal text-muted-foreground">{count}</span>
      </h2>
      {children ? <p className="text-label text-muted-foreground">{children}</p> : null}
    </div>
  );
}

/** The secret, once. It stays until the person says they have copied it. */
function SecretPanel({
  secret,
  inputRef,
  onDone,
}: {
  secret: Secret;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onDone: () => void;
}) {
  const headingId = useId();
  const noteId = useId();
  return (
    <div
      role="region"
      aria-labelledby={headingId}
      className="rounded-lg bg-[var(--tone-warning-bg)] p-4 shadow-[0_0_0_1px_var(--tone-warning-ring)]"
    >
      <h3 id={headingId} className="flex items-start gap-2 font-medium">
        <WarningIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--tone-warning-icon)]" />
        <span className="min-w-0 break-words">New token: {secret.name}</span>
      </h3>
      <p id={noteId} className="mt-1 font-medium">
        {SECRET_NOTE}
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          ref={inputRef}
          readOnly
          value={secret.value}
          aria-label="New token"
          aria-describedby={noteId}
          spellCheck={false}
          autoComplete="off"
          onFocus={(e) => e.currentTarget.select()}
          className={cn(fieldClass, "min-w-0 flex-1 font-mono text-[13px] md:text-[13px]")}
        />
        <CopyButton
          text={secret.value}
          label="Copy the new token"
          onFail={() => inputRef.current?.select()}
          className="max-sm:w-full"
        />
      </div>
      <div className="mt-4">
        <Button type="button" onClick={onDone} className="max-sm:w-full">
          I have copied it
        </Button>
      </div>
    </div>
  );
}

/** Which area of the product each permission touches, in the order they are listed. */
const AREA_TITLE: Record<string, string> = {
  projects: "Projects",
  deployments: "Deployments and logs",
  logs: "Deployments and logs",
  env: "Environment variables",
  domains: "Domains",
  notifications: "Alerts and notifications",
  alerts: "Alerts and notifications",
  analytics: "Analytics",
  resources: "Resources",
  container: "Container",
  activity: "Activity",
  files: "Files",
  terminal: "Terminal",
};

/** Keeps the permissions in the order the API lists them, under a heading for each area. */
function groupScopes(scopes: ScopeOption[]) {
  const groups = new Map<string, ScopeOption[]>();
  for (const s of scopes) {
    const area = AREA_TITLE[s.id.split(":")[0]] ?? "Other";
    groups.set(area, [...(groups.get(area) ?? []), s]);
  }
  return [...groups].map(([title, items]) => ({ title, items }));
}

/** Quick picks for the common jobs. A pick only ever includes permissions that exist. */
const DEPLOY_PRESET = ["projects:read", "deployments:read", "deployments:write", "logs:read"];

function CreateForm({
  scopes,
  disabled,
  limitReached,
  onCreated,
}: {
  scopes: ScopeOption[];
  disabled: boolean;
  limitReached: boolean;
  onCreated: (token: TokenSummary, secret: string) => void;
}) {
  const uid = useId();
  const nameId = `${uid}-name`;
  const nameErrId = `${uid}-name-error`;
  const nameHintId = `${uid}-name-hint`;
  const scopeErrId = `${uid}-scope-error`;
  const scopeCountId = `${uid}-scope-count`;
  const expiryId = `${uid}-expiry`;
  const expiryNoteId = `${uid}-expiry-note`;
  const nameRef = useRef<HTMLInputElement>(null);
  const firstScopeRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [days, setDays] = useState(DEFAULT_EXPIRY_DAYS);
  const [nameError, setNameError] = useState<string | null>(null);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const presets = [
    { label: "Read only", ids: scopes.filter((s) => s.id.endsWith(":read")).map((s) => s.id) },
    { label: "Deploy", ids: DEPLOY_PRESET.filter((id) => scopes.some((s) => s.id === id)) },
  ];

  function toggle(id: string, on: boolean) {
    setScopeError(null);
    setPicked((cur) => {
      const next = new Set(cur);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function applyPreset(ids: string[]) {
    setScopeError(null);
    setPicked(new Set(ids));
  }

  // A container permission (terminal, file changes) caps the token at 7 days, so the choice narrows.
  const pickedList = [...picked];
  const limited = holdsShortLived(pickedList);
  const expiryChoices = allowedExpiries(pickedList);
  const expiryDays = clampExpiry(days, pickedList);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending || disabled) return;
    setServerError(null);
    const trimmed = name.trim();
    const nErr = trimmed ? null : "Give the token a name.";
    const sErr = picked.size === 0 ? "Pick at least one permission." : null;
    setNameError(nErr);
    setScopeError(sErr);
    if (nErr) return nameRef.current?.focus();
    if (sErr) return firstScopeRef.current?.focus();

    setPending(true);
    try {
      const res = await api<{ token: TokenSummary; secret: string }>("/api/tokens", {
        body: {
          name: trimmed,
          // Keep the order the permissions are listed in.
          scopes: scopes.filter((s) => picked.has(s.id)).map((s) => s.id),
          expiresInDays: expiryDays,
        },
      });
      onCreated(res.token, res.secret);
    } catch (err) {
      setServerError(errorText(err, "Could not create the token. Try again."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">
        <div>
          <Label htmlFor={nameId}>Name</Label>
          <Input
            id={nameId}
            ref={nameRef}
            value={name}
            maxLength={NAME_MAX_LENGTH}
            required
            aria-required="true"
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
            So you can tell it apart later, for example standup-bot. Up to {NAME_MAX_LENGTH} characters.
          </p>
          {nameError ? (
            <p id={nameErrId} role="alert" className="mt-1 text-label text-destructive">
              {nameError}
            </p>
          ) : null}
        </div>

        <fieldset className="min-w-0" aria-describedby={scopeError ? scopeErrId : scopeCountId}>
          <legend className="mb-2 text-label text-muted-foreground">Permissions</legend>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {presets.map((p) => (
              <Button key={p.label} type="button" size="sm" variant="outline" onClick={() => applyPreset(p.ids)}>
                {p.label}
              </Button>
            ))}
            <Button type="button" size="sm" variant="ghost" disabled={picked.size === 0} onClick={() => applyPreset([])}>
              Clear
            </Button>
            <span id={scopeCountId} className="tabular ml-auto text-caption text-muted-foreground">
              {picked.size === 0 ? "None picked yet" : `${picked.size} picked`}
            </span>
          </div>
          <ScopeChecklist scopes={scopes} picked={picked} onToggle={toggle} firstRef={firstScopeRef} />
          {scopeError ? (
            <p id={scopeErrId} role="alert" className="mt-1.5 text-label text-destructive">
              {scopeError}
            </p>
          ) : null}
        </fieldset>

        <div>
          <Label htmlFor={expiryId}>Expires after</Label>
          <NativeSelect
            id={expiryId}
            value={expiryDays}
            aria-describedby={limited ? expiryNoteId : undefined}
            onChange={(e) => setDays(Number(e.target.value))}
            className="sm:max-w-48"
          >
            {expiryChoices.map((o) => (
              <option key={o.days} value={o.days}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
          <div role="status">
            {limited ? (
              <p id={expiryNoteId} className="mt-1.5 text-caption text-muted-foreground">
                {SHORT_LIVED_NOTE}
              </p>
            ) : null}
          </div>
        </div>

        {serverError ? (
          <Alert tone="error" role="alert">
            {serverError}
          </Alert>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t px-5 py-3">
        <Button type="submit" loading={pending} disabled={disabled} className="max-sm:w-full">
          {pending ? "Creating…" : "Create token"}
        </Button>
        <DialogClose render={<Button type="button" variant="ghost" className="max-sm:w-full" />}>Cancel</DialogClose>
        {limitReached ? <p className="text-label text-muted-foreground">Revoke a token to make room.</p> : null}
      </div>
    </form>
  );
}

/** The create flow in a dialog. It stays open after creating so the new token can be copied. */
function TokenCreateDialog({
  open,
  onOpenChange,
  scopes,
  disabled,
  limitReached,
  secret,
  secretRef,
  onCreated,
  onSecretDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scopes: ScopeOption[];
  disabled: boolean;
  limitReached: boolean;
  secret: Secret | null;
  secretRef: React.RefObject<HTMLInputElement | null>;
  onCreated: (token: TokenSummary, value: string) => void;
  onSecretDone: () => void;
}) {
  return (
    <Dialog
      open={open}
      // Until the new token is copied, the dialog stays open, so the secret is not lost to a stray Esc.
      onOpenChange={(next) => {
        if (!next && secret) return;
        onOpenChange(next);
      }}
    >
      <DialogContent size="lg">
        <div className="border-b px-5 py-4">
          <DialogTitle className="text-title-3">{secret ? "Your new token" : "Create a token"}</DialogTitle>
          <DialogDescription className="mt-1 text-label">
            {secret
              ? "Copy it now. It is shown once."
              : "Pick only what the script or agent needs. You can change the permissions later."}
          </DialogDescription>
        </div>
        {secret ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <SecretPanel secret={secret} inputRef={secretRef} onDone={onSecretDone} />
          </div>
        ) : (
          <CreateForm scopes={scopes} disabled={disabled} limitReached={limitReached} onCreated={onCreated} />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The permission checkboxes, grouped by area. Shared by the create dialog and the token editor. */
function ScopeChecklist({
  scopes,
  picked,
  onToggle,
  firstRef,
}: {
  scopes: ScopeOption[];
  picked: Set<string>;
  onToggle: (id: string, on: boolean) => void;
  firstRef?: React.Ref<HTMLInputElement>;
}) {
  const groupId = useId();
  const firstId = scopes[0]?.id;
  return (
    <div className="space-y-4">
      {groupScopes(scopes).map((group) => (
        <div key={group.title}>
          <h4 className="mb-1.5 text-caption font-medium text-muted-foreground">{group.title}</h4>
          <ul className="hairline-y overflow-hidden rounded-md shadow-border-base">
            {group.items.map((s) => {
              const change = isChangeScope(s.id);
              const badge = scopeBadge(s.id);
              const note = scopeNote(s.id);
              const noteId = note ? `${groupId}-${s.id.replace(/\W/g, "-")}-note` : undefined;
              return (
                <li key={s.id}>
                  <label
                    className={cn(
                      "flex min-h-11 cursor-pointer items-start gap-3 px-3 py-2.5 max-sm:min-h-12",
                      change && "bg-[var(--tone-warning-bg)]"
                    )}
                  >
                    <input
                      ref={s.id === firstId ? firstRef : undefined}
                      type="checkbox"
                      className="mt-1 shrink-0"
                      checked={picked.has(s.id)}
                      aria-describedby={noteId}
                      onChange={(e) => onToggle(s.id, e.target.checked)}
                    />
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span>{s.label}</span>
                        {badge ? (
                          <span className="inline-flex items-center gap-1 rounded-sm bg-background px-1.5 py-0.5 text-caption font-medium shadow-[0_0_0_1px_var(--tone-warning-ring)]">
                            <WarningIcon aria-hidden="true" className="size-3 text-[var(--tone-warning-icon)]" />
                            {badge}
                          </span>
                        ) : null}
                      </span>
                      <span className="block font-mono text-caption text-muted-foreground">{s.id}</span>
                      {note ? (
                        <span id={noteId} className="mt-1 block max-w-[62ch] text-caption text-muted-foreground">
                          {note}
                        </span>
                      ) : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function TokenRow({
  token,
  now,
  scopes,
  expiringSoon = false,
  onRevoke,
  onSave,
}: {
  token: TokenSummary;
  now: number;
  scopes: ScopeOption[];
  /** An active token that ends within 7 days: its status reads "Expires soon". */
  expiringSoon?: boolean;
  onRevoke: () => Promise<void>;
  onSave: (token: TokenSummary, patch: TokenPatch) => Promise<void>;
}) {
  const status = tokenStatus(token, now);
  const dim = status !== "active";
  const [editing, setEditing] = useState(false);
  const [showScopes, setShowScopes] = useState(false);
  const editRef = useRef<HTMLButtonElement>(null);
  const editorId = useId();
  const scopesId = useId();
  const editable = canEdit(token, now);
  const soon = status === "active" && expiringSoon;
  const changes = token.scopes.filter(isChangeScope).length;

  function closeEditor() {
    setEditing(false);
    // Back to the control that opened it, once it is on screen again.
    requestAnimationFrame(() => editRef.current?.focus());
  }

  return (
    <li className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className={cn("min-w-0 font-medium break-words", dim && "text-muted-foreground")}>{token.name}</p>
            <StatusIndicator
              tone={soon ? "warning" : TONE_FOR[status]}
              label={soon ? "Expires soon" : STATUS_LABEL[status]}
              className="text-label"
            />
          </div>
          <p className="mt-0.5 font-mono text-caption text-muted-foreground">
            <span className="sr-only">Starts with </span>
            {token.prefix}
          </p>
        </div>
        {editable ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              ref={editRef}
              type="button"
              variant="outline"
              size="sm"
              aria-label={`Edit ${token.name}`}
              aria-expanded={editing}
              aria-controls={editing ? editorId : undefined}
              onClick={() => (editing ? closeEditor() : setEditing(true))}
            >
              Edit
            </Button>
            <ConfirmDialog
              trigger={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Revoke ${token.name}`}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  Revoke
                </Button>
              }
              tone="destructive"
              title={`Revoke "${token.name}"?`}
              description="Anything using this token stops working right away. This cannot be undone."
              confirmLabel="Revoke token"
              pendingLabel="Revoking…"
              onConfirm={onRevoke}
            />
          </div>
        ) : null}
      </div>

      {editing ? (
        <TokenEditor
          id={editorId}
          token={token}
          scopes={scopes}
          onSave={async (patch) => {
            await onSave(token, patch);
            closeEditor();
          }}
          onCancel={closeEditor}
        />
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 text-label sm:grid-cols-4">
            <Meta label="Permissions">
              <button
                type="button"
                aria-expanded={showScopes}
                aria-controls={scopesId}
                onClick={() => setShowScopes((v) => !v)}
                // 40px to touch on phones, without growing the row: the margins take back the extra height.
                className="touch-target pressable -mx-1 inline-flex items-center gap-1 rounded-sm px-1 align-top sm:hover:bg-muted max-sm:-my-[11px] max-sm:min-h-10"
              >
                <span className="tabular">
                  {token.scopes.length} {token.scopes.length === 1 ? "permission" : "permissions"}
                </span>
                {changes > 0 ? (
                  <>
                    <WarningIcon aria-hidden="true" className="size-3.5 text-[var(--tone-warning-icon)]" />
                    <span className="sr-only">, {changes} can change things</span>
                  </>
                ) : null}
                <CaretDownIcon
                  aria-hidden="true"
                  className={cn(
                    "size-3 text-muted-foreground transition-transform duration-(--dur-fast) motion-reduce:transition-none",
                    showScopes && "rotate-180"
                  )}
                />
              </button>
            </Meta>
            <Meta label="Created">{formatDate(token.createdAt)}</Meta>
            <Meta label="Last used">{lastUsedLabel(token.lastUsedAt, now)}</Meta>
            <Meta label={status === "revoked" ? "Was due" : status === "expired" ? "Expired" : "Expires"}>
              <span className={cn(soon && "font-medium")}>
                {expiryLabel(token, now)}
              </span>
            </Meta>
          </dl>

          <ul
            id={scopesId}
            hidden={!showScopes}
            aria-label={`Permissions of ${token.name}`}
            className="mt-3 flex flex-wrap gap-1.5"
          >
            {token.scopes.map((s) => (
              <li
                key={s}
                className={cn(
                  "rounded-sm px-1.5 py-0.5 font-mono text-caption",
                  isChangeScope(s)
                    ? "bg-[var(--tone-warning-bg)] shadow-[0_0_0_1px_var(--tone-warning-ring)]"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {s}
              </li>
            ))}
          </ul>
        </>
      )}
    </li>
  );
}

/**
 * Inline editor for one active token. It sends only what changed; the secret
 * is never involved. Changes apply to the very next request that uses the token.
 */
function TokenEditor({
  id,
  token,
  scopes,
  onSave,
  onCancel,
}: {
  id: string;
  token: TokenSummary;
  scopes: ScopeOption[];
  onSave: (patch: TokenPatch) => Promise<void>;
  onCancel: () => void;
}) {
  const nameId = `${id}-name`;
  const nameErrId = `${id}-name-error`;
  const scopeErrId = `${id}-scope-error`;
  const expiryId = `${id}-expiry`;
  const expiryNoteId = `${id}-expiry-note`;
  const nameRef = useRef<HTMLInputElement>(null);
  const firstScopeRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(token.name);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(token.scopes));
  const [expiry, setExpiry] = useState<ExpiryChoice>("keep");
  const [nameError, setNameError] = useState<string | null>(null);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  // Keep the order the permissions are listed in.
  const chosen = scopes.filter((s) => picked.has(s.id)).map((s) => s.id);
  const dropsDeploy = dropsDeployAccess(token.scopes, chosen);

  // A container permission caps the token at 7 days. "Keep" only stays while it already ends that soon.
  const limited = holdsShortLived(chosen);
  const keepAllowed = clampEditExpiry("keep", chosen, token) === "keep";
  const expiryChoices = allowedExpiries(chosen);
  const expiryValue = clampEditExpiry(expiry, chosen, token);

  function toggle(scopeId: string, on: boolean) {
    setScopeError(null);
    setPicked((cur) => {
      const next = new Set(cur);
      if (on) next.add(scopeId);
      else next.delete(scopeId);
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setServerError(null);
    const nErr = name.trim() ? null : "Give the token a name.";
    const sErr = chosen.length === 0 ? "Pick at least one permission." : null;
    setNameError(nErr);
    setScopeError(sErr);
    if (nErr) return nameRef.current?.focus();
    if (sErr) return firstScopeRef.current?.focus();

    const patch = buildTokenPatch(token, { name, scopes: chosen, expiry: expiryValue });
    if (Object.keys(patch).length === 0) return onCancel();

    setPending(true);
    try {
      await onSave(patch);
    } catch (err) {
      setServerError(errorText(err, "Could not save the changes. Try again."));
      setPending(false);
    }
  }

  return (
    <form
      id={id}
      onSubmit={submit}
      noValidate
      aria-label={`Edit ${token.name}`}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !pending) onCancel();
      }}
      className="mt-3 space-y-4 rounded-md bg-muted/40 p-4 shadow-border-base"
    >
      <div>
        <Label htmlFor={nameId}>Name</Label>
        <Input
          id={nameId}
          ref={nameRef}
          value={name}
          maxLength={NAME_MAX_LENGTH}
          required
          aria-required="true"
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? nameErrId : undefined}
          autoComplete="off"
          onChange={(e) => {
            setName(e.target.value);
            setNameError(null);
          }}
          className="sm:max-w-sm"
        />
        {nameError ? (
          <p id={nameErrId} role="alert" className="mt-1 text-label text-destructive">
            {nameError}
          </p>
        ) : null}
      </div>

      <fieldset className="min-w-0" aria-describedby={scopeError ? scopeErrId : undefined}>
        <legend className="mb-1.5 text-label text-muted-foreground">Permissions</legend>
        <ScopeChecklist scopes={scopes} picked={picked} onToggle={toggle} firstRef={firstScopeRef} />
        {scopeError ? (
          <p id={scopeErrId} role="alert" className="mt-1.5 text-label text-destructive">
            {scopeError}
          </p>
        ) : null}
        <div role="status">
          {dropsDeploy ? (
            <Alert tone="warning" className="mt-2 p-3 text-label">
              {DEPLOY_DROP_NOTE}
            </Alert>
          ) : null}
        </div>
      </fieldset>

      <div>
        <Label htmlFor={expiryId}>Expires after</Label>
        <NativeSelect
          id={expiryId}
          value={expiryValue}
          aria-describedby={limited ? expiryNoteId : undefined}
          onChange={(e) => setExpiry(e.target.value === "keep" ? "keep" : (Number(e.target.value) as ExpiryChoice))}
          className="sm:max-w-64"
        >
          {keepAllowed ? <option value="keep">Keep current ({formatDate(token.expiresAt)})</option> : null}
          {expiryChoices.map((o) => (
            <option key={o.days} value={o.days}>
              {o.label} from now
            </option>
          ))}
        </NativeSelect>
        <p className="mt-1.5 text-caption text-muted-foreground">
          A new expiry counts from today, so it can make the token last longer or end sooner.
        </p>
        <div role="status">
          {limited ? (
            <p id={expiryNoteId} className="mt-1 text-caption text-muted-foreground">
              {SHORT_LIVED_NOTE}
            </p>
          ) : null}
        </div>
      </div>

      {serverError ? (
        <Alert tone="error" role="alert">
          {serverError}
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={pending} className="max-sm:w-full">
          {pending ? "Saving…" : "Save changes"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending} className="max-sm:w-full">
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="tabular mt-0.5">{children}</dd>
    </div>
  );
}
