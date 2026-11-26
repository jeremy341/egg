"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { api } from "@/components/api";
import { Card, Label } from "@/components/settings-ui";
import { Alert } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { fieldClass, Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/** The modes the server accepts (accessProtectionConfigSchema). */
export type AccessMode = "off" | "password" | "basic-auth" | "egg" | "open" | "sign_in";

/**
 * The settings GET and PUT /api/projects/[id]/access-protection exchange. The
 * password is accepted on save and never returned; only whether one is set comes back.
 * This shape is what the card expects; the route does not expose it yet.
 */
export type AccessView = {
  mode: AccessMode;
  excludedPaths: string[];
  username: string | null;
  passwordSet: boolean;
};

const MODES: { value: AccessMode; label: string; hint: string }[] = [
  { value: "off", label: "Off", hint: "Anyone with the address can reach the site." },
  { value: "password", label: "Shared password", hint: "Visitors enter one password before they see the site." },
  { value: "basic-auth", label: "Username and password", hint: "Visitors enter a username and password from their browser." },
  { value: "egg", label: "Egg sign-in", hint: "Visitors must sign in to Egg before they see the site." },
];

/** Same minimum the server enforces. */
const MIN_PASSWORD = 12;
const TOUCH = "min-h-10";

/** One path per non-empty line. */
function parsePaths(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** The first path that is not usable, as a message, or null when all are fine. */
function pathProblem(paths: string[]): string | null {
  const bad = paths.find((p) => !p.startsWith("/") || p.length > 300);
  return bad === undefined ? null : `Each path must start with / and be at most 300 characters. "${bad}" does not.`;
}

/**
 * Who can reach the project's site, which paths skip that check, and the shared
 * credentials. Turning protection off asks for confirmation first.
 */
export function AccessProtectionCard({ projectId }: { projectId: string }) {
  const ids = useId();
  const modeId = `${ids}-mode`;
  const pathsId = `${ids}-paths`;
  const usernameId = `${ids}-username`;
  const passwordId = `${ids}-password`;

  const [saved, setSaved] = useState<AccessView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<AccessMode>("off");
  const [pathsText, setPathsText] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const url = `/api/projects/${encodeURIComponent(projectId)}/access-protection`;

  const applyView = useCallback((view: AccessView) => {
    // The GET route reports the stored state as open/sign_in; the form and the
    // PUT body use off/egg. Normalize before putting the value in the select.
    const normalized: AccessView = {
      ...view,
      mode: view.mode === "open" ? "off" : view.mode === "sign_in" ? "egg" : view.mode,
    };
    setSaved(normalized);
    setMode(normalized.mode);
    setPathsText(normalized.excludedPaths.join("\n"));
    setUsername(normalized.username ?? "");
    setPassword("");
  }, []);

  const load = useCallback(async () => {
    try {
      const view = await api<AccessView>(url);
      applyView(view);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load access settings.");
    }
  }, [url, applyView]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads from the server on mount
    void load();
  }, [load]);

  const needsUsername = mode === "basic-auth";
  const needsPassword = mode === "password" || mode === "basic-auth";
  const paths = parsePaths(pathsText);
  const pathError = pathProblem(paths);
  const usernameMissing = needsUsername && username.trim() === "";
  const passwordMissing = needsPassword && !(saved?.passwordSet ?? false) && password === "";
  const passwordShort = needsPassword && password !== "" && password.length < MIN_PASSWORD;
  const invalid = pathError !== null || usernameMissing || passwordMissing || passwordShort;
  const removingProtection = saved !== null && saved.mode !== "off" && mode === "off";
  const dirty =
    saved !== null &&
    (mode !== saved.mode ||
      paths.join("\n") !== saved.excludedPaths.join("\n") ||
      username.trim() !== (saved.username ?? "") ||
      password !== "");

  /** Throws on failure, so a confirmation dialog can show the message itself. */
  async function save() {
    setSaveError(null);
    if (invalid) {
      const message = pathError ?? (usernameMissing ? "Enter a username." : passwordShort ? `Use at least ${MIN_PASSWORD} characters.` : "Set a password for this mode.");
      setSaveError(message);
      throw new Error(message);
    }
    setSaving(true);
    try {
      const body: { mode: AccessMode; excludedPaths: string[]; username?: string; password?: string } = {
        mode,
        excludedPaths: mode === "off" ? [] : paths,
      };
      if (needsUsername) body.username = username.trim();
      if (needsPassword && password !== "") body.password = password;
      const view = await api<AccessView>(url, { method: "PUT", body });
      applyView(view);
      toast.success("Access settings saved");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not save access settings.";
      setSaveError(message);
      throw e;
    } finally {
      setSaving(false);
    }
  }

  const canSave = !saving && dirty && !invalid;

  return (
    <Card
      id="access-protection-heading"
      title="Access protection"
      description="Decide who can see your site before they reach it."
    >
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
      ) : null}

      {saved === null && loadError === null ? (
        <p className="text-muted-foreground" role="status">
          Loading access settings…
        </p>
      ) : null}

      {saved !== null ? (
        <form
          className="space-y-5"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!removingProtection) void save().catch(() => undefined);
          }}
        >
          <div>
            <Label htmlFor={modeId}>Who can see the site</Label>
            <NativeSelect
              id={modeId}
              value={mode}
              onChange={(e) => setMode(e.target.value as AccessMode)}
              disabled={saving}
              aria-describedby={`${modeId}-hint`}
            >
              {MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </NativeSelect>
            <p id={`${modeId}-hint`} className="mt-1.5 text-label text-muted-foreground">
              {MODES.find((m) => m.value === mode)?.hint}
            </p>
          </div>

          {needsUsername ? (
            <div>
              <Label htmlFor={usernameId}>Username</Label>
              <Input
                id={usernameId}
                autoComplete="off"
                spellCheck={false}
                maxLength={128}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={saving}
                aria-invalid={usernameMissing ? true : undefined}
                aria-describedby={usernameMissing ? `${usernameId}-error` : undefined}
                className="min-h-10"
              />
              {usernameMissing ? (
                <p id={`${usernameId}-error`} role="alert" className="mt-1.5 text-label text-destructive">
                  Enter a username.
                </p>
              ) : null}
            </div>
          ) : null}

          {needsPassword ? (
            <div>
              <Label htmlFor={passwordId}>{mode === "basic-auth" ? "Password" : "Shared password"}</Label>
              <Input
                id={passwordId}
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={saving}
                aria-invalid={passwordMissing || passwordShort ? true : undefined}
                aria-describedby={`${passwordId}-hint`}
                className="min-h-10"
              />
              <p
                id={`${passwordId}-hint`}
                className={cn(
                  "mt-1.5 text-label",
                  passwordMissing || passwordShort ? "text-destructive" : "text-muted-foreground"
                )}
              >
                {passwordShort
                  ? `Use at least ${MIN_PASSWORD} characters.`
                  : passwordMissing
                    ? "Set a password for this mode before you save."
                    : saved.passwordSet
                      ? "A password is set. Type a new one to replace it, or leave this blank to keep it."
                      : `At least ${MIN_PASSWORD} characters. It is not shown again after you save.`}
              </p>
            </div>
          ) : null}

          {mode !== "off" ? (
            <div>
              <Label htmlFor={pathsId}>Paths that skip this check</Label>
              <textarea
                id={pathsId}
                value={pathsText}
                onChange={(e) => setPathsText(e.target.value)}
                disabled={saving}
                rows={4}
                spellCheck={false}
                autoComplete="off"
                placeholder={"/health\n/public/*"}
                aria-invalid={pathError ? true : undefined}
                aria-describedby={pathError ? `${pathsId}-error` : `${pathsId}-hint`}
                className={cn(fieldClass, "h-auto min-h-24 py-2 font-mono")}
              />
              {pathError ? (
                <p id={`${pathsId}-error`} role="alert" className="mt-1.5 text-label text-destructive">
                  {pathError}
                </p>
              ) : (
                <p id={`${pathsId}-hint`} className="mt-1.5 text-label text-muted-foreground">
                  One path per line, starting with /. Requests to these paths are not checked.
                </p>
              )}
            </div>
          ) : null}

          {saveError && !pathError ? (
            <p role="alert" className="text-label text-destructive">
              {saveError}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            {removingProtection ? (
              <ConfirmDialog
                trigger={
                  <Button type="button" variant="destructive" className={TOUCH} disabled={!canSave}>
                    Save access settings
                  </Button>
                }
                tone="destructive"
                title="Turn off access protection?"
                description="Anyone with the address will be able to see the site. The password or sign-in requirement stops as soon as you confirm."
                confirmLabel="Turn off protection"
                pendingLabel="Saving…"
                onConfirm={save}
              />
            ) : (
              <Button type="submit" className={TOUCH} disabled={!canSave}>
                {saving ? "Saving…" : "Save access settings"}
              </Button>
            )}
          </div>
        </form>
      ) : null}
    </Card>
  );
}
