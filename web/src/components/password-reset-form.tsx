"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { api } from "@/components/api";
import { CopyField } from "@/components/copy-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const labelClass = "mb-1.5 block text-[13px] text-muted-foreground";

/** "Forgot your password?": a recovery key and a new password. A good reset shows the next key once. */
export function PasswordResetForm() {
  const ids = useId();
  const [email, setEmail] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const done = await api<{ recoveryKey: string }>("/api/auth/password/reset", {
        body: { email, recoveryKey, newPassword: password, confirmPassword: confirm },
      });
      setNewKey(done.recoveryKey);
      setPassword("");
      setConfirm("");
      setRecoveryKey("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset the password.");
    } finally {
      setBusy(false);
    }
  }

  if (newKey) {
    return (
      <div className="space-y-3">
        <Alert tone="success" role="status">
          Your password is reset and you are signed out everywhere.
        </Alert>
        <div>
          <p className={labelClass}>Your new recovery key</p>
          <CopyField value={newKey} label="New recovery key" />
          <p className="mt-2 text-[13px] text-muted-foreground">
            This key will not be shown again, and the old one no longer works. Keep it somewhere safe.
          </p>
        </div>
        <Link href="/login?method=password" className="link text-[13px] font-medium">
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div>
        <label htmlFor={`${ids}-email`} className={labelClass}>Email</label>
        <Input id={`${ids}-email`} type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
      </div>
      <div>
        <label htmlFor={`${ids}-key`} className={labelClass}>Recovery key</label>
        <Input id={`${ids}-key`} type="password" autoComplete="off" required maxLength={64} value={recoveryKey} onChange={(event) => setRecoveryKey(event.target.value)} />
      </div>
      <div>
        <label htmlFor={`${ids}-new`} className={labelClass}>New password (12 characters minimum)</label>
        <Input id={`${ids}-new`} type="password" autoComplete="new-password" required minLength={12} maxLength={256} value={password} onChange={(event) => setPassword(event.target.value)} />
      </div>
      <div>
        <label htmlFor={`${ids}-confirm`} className={labelClass}>Confirm new password</label>
        <Input id={`${ids}-confirm`} type="password" autoComplete="new-password" required minLength={12} maxLength={256} value={confirm} onChange={(event) => setConfirm(event.target.value)} />
      </div>
      {error ? <Alert tone="error" role="alert">{error}</Alert> : null}
      <Button type="submit" size="lg" className="w-full" disabled={busy} loading={busy}>
        {busy ? "Resetting…" : "Reset password"}
      </Button>
      <p className="text-[13px] text-muted-foreground">
        <Link href="/login?method=password" className="link">Back to sign in</Link>
      </p>
    </form>
  );
}
