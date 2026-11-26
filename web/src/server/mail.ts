import { config } from "@/server/config";

/**
 * Email is optional. With EMAIL_WEBHOOK_URL set, each message is POSTed as JSON
 * to that URL; without it, `mailConfigured()` is false and callers fall back to
 * showing a link once. Nothing here logs the message body, because invitation
 * links are bearer secrets.
 */
export type MailMessage = { to: string; subject: string; text: string };
export type MailSender = (message: MailMessage) => Promise<void>;

let override: MailSender | null = null;

/** Test hook: replace the transport. Pass null to restore the configured one. */
export function setMailSenderForTests(sender: MailSender | null): void {
  override = sender;
}

export function mailConfigured(): boolean {
  return override !== null || Boolean(config().EMAIL_WEBHOOK_URL);
}

/** Send one message. Resolves true when delivered, false when no transport is set or it failed. */
export async function sendMail(message: MailMessage): Promise<boolean> {
  try {
    if (override) {
      await override(message);
      return true;
    }
    const url = config().EMAIL_WEBHOOK_URL;
    if (!url) return false;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch (err) {
    console.warn("email send failed", err instanceof Error ? err.name : "error");
    return false;
  }
}
