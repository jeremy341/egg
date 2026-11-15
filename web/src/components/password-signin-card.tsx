"use client";

import { useId, useState } from "react";
import { Switch } from "@base-ui/react/switch";
import { api } from "@/components/api";
import { CopyField } from "@/components/copy-field";
import { Card, Label } from "@/components/settings-ui";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Setup = { recoveryKey: string; expiresAt: number; ticket: string };
type Mode = "idle" | "setup" | "disable" | "change" | "signed-out";

/**
 * The optional password for signing in. Off until the person turns it on.
 * Turning on shows a recovery key once and asks for a password; turning off
 * asks for the password or the recovery key. The server enforces every rule
 * here, including the one that refuses to leave the account with no way in.
 */
export function PasswordSignInCard({
  enabled: initiallyEnabled,
  email,
  canTurnOff,
}: {
  enabled: boolean;
  /** The address to sign in with; null when the account shares none. */
  email: string | null;
  /** False when turning it off would leave no other way to sign in. */
  canTurnOff: boolean;
}) {
  const ids = useId();
  const [enabled, setEnabled] = useState(initiallyEnabled);
  const [mode, setMode] = useState<Mode>("idle");
  const [setup, setSetup] = useState<Setup | null>(null);
  const [saved, setSaved] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [useKey, setUseKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const switchDisabled = busy || !email || mode === "signed-out" || (enabled && !canTurnOff);

  function reset(next: Mode = "idle") {
    setMode(next);
    setSetup(null);
    setSaved(false);
    setPassword("");
    setConfirm("");
    setCurrentPassword("");
    setRecoveryKey("");
    setUseKey(false);
    setError(null);
  }

  async function run(work: () => Promise<void>, fallback: string) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      if (err instanceof Error && (err as Error & { code?: string }).code === "reauth_required") {
        // Turning on needs a fresh Hack Club sign-in. Send the person there and bring them back here.
        // This is an API route that redirects to Hack Club, so it has to be a full navigation, not a router push.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign(`/api/auth/reauth?next=${encodeURIComponent("/account#password-signin-heading")}`);
        return;
      }
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  function toggle(next: boolean) {
    if (next && !enabled) {
      void run(async () => {
        setSetup(await api<Setup>("/api/account/password", { body: { action: "prepare" } }));
        setMode("setup");
      }, "Could not start. Try again.");
    } else if (!next && enabled) {
      reset("disable");
    }
  }

  function turnOn() {
    if (!setup) return;
    void run(async () => {
      await api("/api/account/password", {
        body: {
          action: "enable",
          recoveryKey: setup.recoveryKey,
          expiresAt: setup.expiresAt,
          ticket: setup.ticket,
          savedRecoveryKey: saved,
          password,
          confirmPassword: confirm,
        },
      });
      setEnabled(true);
      reset();
    }, "Could not turn on password sign-in.");
  }

  function turnOff() {
    void run(async () => {
      await api("/api/account/password", {
        body: {
          action: "disable",
          ...(useKey ? { recoveryKey } : { currentPassword }),
        },
      });
      setEnabled(false);
      reset();
    }, "Could not turn off password sign-in.");
  }

  function changePassword() {
    void run(async () => {
      await api("/api/account/password", {
        body: { action: "change", currentPassword, newPassword: password, confirmPassword: confirm },
      });
      // Every session ended, this one too.
      reset("signed-out");
    }, "Could not change the password.");
  }

  const description = !email
    ? "Your account does not share an email address, so a password cannot be used to sign in."
    : enabled
      ? `You can sign in with ${email} and your password, as well as with Hack Club.`
      : "Off. You sign in with Hack Club. Turn this on to also sign in with your email and a password.";

  return (
    <Card id="password-signin-heading" title="Sign in with a password" description={description}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <span id={`${ids}-state`} className="text-label text-muted-foreground">
            {enabled ? "On" : "Off"}
          </span>
          <Switch.Root
            nativeButton
            render={<button type="button" />}
            checked={enabled}
            disabled={switchDisabled}
            onCheckedChange={toggle}
            aria-labelledby="password-signin-heading"
            aria-describedby={`${ids}-state`}
            className={cn(
              "touch-target relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full p-0.5 outline-none",
              "bg-[var(--ds-gray-700)] data-[checked]:bg-foreground",
              "transition-colors duration-(--dur-fast) ease-snappy",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ds-focus-color)]",
              "disabled:cursor-not-allowed disabled:opacity-50",
              "before:absolute before:-inset-2 before:content-[''] sm:before:-inset-1"
            )}
          >
            <Switch.Thumb
              className={cn(
                "pointer-events-none block size-5 rounded-full bg-background shadow-sm",
                "transition-transform duration-(--dur-fast) ease-snappy",
                "data-[checked]:translate-x-5"
              )}
            />
          </Switch.Root>
        </div>

        {enabled && !canTurnOff && mode === "idle" ? (
          <Alert tone="note">
            This is the only way you can sign in here, so it cannot be turned off.
          </Alert>
        ) : null}

        {mode === "setup" && setup ? (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              turnOn();
            }}
          >
            <div>
              <p className="mb-1.5 text-label text-muted-foreground">Your recovery key</p>
              <CopyField value={setup.recoveryKey} label="Recovery key" />
              <p className="mt-2 text-muted-foreground">
                This key will not be shown again. Keep it somewhere safe, such as a password manager. You need it
                to reset a lost password.
              </p>
            </div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={saved}
                onChange={(event) => setSaved(event.target.checked)}
                className="size-4 shrink-0 accent-[var(--ds-focus-color)]"
              />
              <span>I have saved the recovery key</span>
            </label>
            <div>
              <Label htmlFor={`${ids}-new`}>Password (12 characters minimum)</Label>
              <Input
                id={`${ids}-new`}
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={256}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor={`${ids}-confirm`}>Confirm password</Label>
              <Input
                id={`${ids}-confirm`}
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={256}
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy || !saved} loading={busy}>
                {busy ? "Turning on…" : "Turn on"}
              </Button>
              <Button type="button" variant="outline" disabled={busy} onClick={() => reset()}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}

        {mode === "disable" ? (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              turnOff();
            }}
          >
            <div>
              <Label htmlFor={`${ids}-proof`}>{useKey ? "Recovery key" : "Current password"}</Label>
              <Input
                key={useKey ? "key" : "password"}
                id={`${ids}-proof`}
                type="password"
                autoComplete={useKey ? "off" : "current-password"}
                maxLength={useKey ? 64 : 256}
                value={useKey ? recoveryKey : currentPassword}
                onChange={(event) => (useKey ? setRecoveryKey(event.target.value) : setCurrentPassword(event.target.value))}
              />
            </div>
            <button
              type="button"
              className="touch-target link text-label font-medium max-sm:min-h-10"
              onClick={() => {
                setUseKey(!useKey);
                setError(null);
              }}
            >
              {useKey ? "Use my password instead" : "Use my recovery key instead"}
            </button>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy || (useKey ? !recoveryKey : !currentPassword)} loading={busy}>
                {busy ? "Turning off…" : "Turn off"}
              </Button>
              <Button type="button" variant="outline" disabled={busy} onClick={() => reset()}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}

        {mode === "change" ? (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              changePassword();
            }}
          >
            <p className="text-muted-foreground">
              Changing your password signs you out everywhere, including here. Sign in again with the new one.
            </p>
            <div>
              <Label htmlFor={`${ids}-current`}>Current password</Label>
              <Input
                id={`${ids}-current`}
                type="password"
                autoComplete="current-password"
                maxLength={256}
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor={`${ids}-next`}>New password (12 characters minimum)</Label>
              <Input
                id={`${ids}-next`}
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={256}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor={`${ids}-next-confirm`}>Confirm new password</Label>
              <Input
                id={`${ids}-next-confirm`}
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={256}
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy} loading={busy}>
                {busy ? "Changing password…" : "Change password and sign out"}
              </Button>
              <Button type="button" variant="outline" disabled={busy} onClick={() => reset()}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}

        {enabled && mode === "idle" ? (
          <div>
            <Button type="button" variant="outline" onClick={() => reset("change")}>
              Change password
            </Button>
          </div>
        ) : null}

        {mode === "signed-out" ? (
          <Alert tone="success" role="status">
            Password changed. You are signed out everywhere.{" "}
            <a href="/login?method=password" className="link font-medium">
              Sign in again
            </a>
          </Alert>
        ) : null}

        {error ? (
          <Alert tone="error" role="alert">
            {error}
          </Alert>
        ) : null}
      </div>
    </Card>
  );
}
