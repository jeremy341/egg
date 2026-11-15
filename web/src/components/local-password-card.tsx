"use client";

import { useState } from "react";
import { api } from "@/components/api";
import { Card, Label } from "@/components/settings-ui";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LocalPasswordCard() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function changePassword() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api("/api/account/local-password", {
        method: "POST",
        body: { currentPassword, newPassword, confirmPassword },
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      id="local-password-heading"
      title="Local sign-in password"
      description="Change the password for this local owner account. Other signed-in browsers and open terminals will be closed."
      footer={
        <Button onClick={() => void changePassword()} disabled={busy} loading={busy}>
          {busy ? "Changing password…" : "Change password"}
        </Button>
      }
    >
      <div className="space-y-3">
        <div>
          <Label htmlFor="current-local-password">Current password</Label>
          <Input
            id="current-local-password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="new-local-password">New password (12 characters minimum)</Label>
          <Input
            id="new-local-password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={256}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="confirm-local-password">Confirm new password</Label>
          <Input
            id="confirm-local-password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={256}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </div>
        {error ? <Alert tone="error" role="alert">{error}</Alert> : null}
        {saved ? <Alert tone="success" role="status">Password changed. This browser remains signed in.</Alert> : null}
      </div>
    </Card>
  );
}
