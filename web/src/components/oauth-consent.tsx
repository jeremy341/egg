import { CheckIcon, XIcon } from "@phosphor-icons/react/dist/ssr";
import { Card } from "@/components/settings-ui";
import { Button } from "@/components/ui/button";

/**
 * Plain-language meanings for the OAuth scopes. The hierarchy is cumulative:
 * mcp:read < mcp:deploy < mcp:exec, so an app asking for a higher scope can do
 * everything the lower ones allow. Keep this in sync with `@/server/oauth`.
 */
const SCOPE_DESCRIPTIONS: Record<string, string> = {
  "mcp:read": "See your projects, deployments, logs and settings.",
  "mcp:deploy": "Everything in read, plus deploy, restart and change your projects.",
  "mcp:exec": "Everything above, plus run commands in your containers and read or write files.",
};

/** A detail row in the request summary. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 px-4 py-3 sm:grid-cols-[130px_minmax(0,1fr)] sm:gap-4">
      <dt className="text-label text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/**
 * The consent screen for a third-party OAuth client. Server-rendered on purpose:
 * the approve/deny buttons are a normal form post, so the flow works without
 * JavaScript and the same-origin check on the API route protects the POST.
 *
 * Every value shown here came from the server's validated request — the hidden
 * fields only travel back so the API can re-check the exact same request. Never
 * treat them as trusted input on their own.
 */
export function OAuthConsent({
  clientName,
  clientHost,
  redirectUri,
  scopes,
  fields,
}: {
  clientName: string;
  /** Host of the redirect URI — the closest thing to "who is asking" we have. */
  clientHost: string;
  /** The complete, exact redirect URI the code will be sent to. */
  redirectUri: string;
  scopes: string[];
  /** Hidden form fields that identify the authorization request. */
  fields: Record<string, string>;
}) {
  return (
    <Card
      id="oauth-consent-heading"
      title={`Authorize ${clientName}`}
      description="Check what this app is asking for before you decide."
    >
      <div className="space-y-5">
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">{clientName}</span> is asking to act on your Egg
          account. Only approve if you trust this app. You can revoke its access later in Settings.
        </p>

        <dl className="hairline-y overflow-hidden rounded-md shadow-border-base">
          <Row label="Client">{clientName}</Row>
          <Row label="Host">{clientHost}</Row>
          <Row label="Redirect to">
            <code className="block break-all font-mono text-[13px]">{redirectUri}</code>
          </Row>
        </dl>

        <div>
          <p className="mb-2 text-label text-muted-foreground">Access requested</p>
          <ul className="space-y-2">
            {scopes.map((scope) => (
              <li key={scope} className="flex gap-2.5">
                <CheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--tone-success-icon)]" />
                <div className="min-w-0">
                  <code className="font-mono text-[13px]">{scope}</code>
                  <p className="text-muted-foreground">{SCOPE_DESCRIPTIONS[scope] ?? "Access to your Egg account."}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <form method="post" action="/api/oauth/authorize" className="space-y-3">
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" name="decision" value="approve" variant="brand">
              Approve
            </Button>
            <Button type="submit" name="decision" value="deny" variant="outline">
              <XIcon aria-hidden="true" />
              Deny
            </Button>
          </div>
        </form>
      </div>
    </Card>
  );
}
