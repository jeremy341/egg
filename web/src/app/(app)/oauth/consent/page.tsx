import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { OAuthConsent } from "@/components/oauth-consent";
import { PageHeader } from "@/components/page-header";
import { Alert } from "@/components/ui/alert";
import { getCurrentUser } from "@/server/auth/current";
import {
  getClient,
  MCP_SCOPES,
  redirectHost,
  summarizeClient,
  validateRedirectUri,
} from "@/server/oauth";

export const metadata = { title: "Authorize app" };

const ERROR_MESSAGES: Record<string, string> = {
  invalid_request: "This authorization link is incomplete or malformed. Ask the app to try again.",
  invalid_client: "This app is not registered with Egg, so it cannot be authorized.",
  invalid_redirect_uri: "This app's redirect address is not registered, so the code cannot be sent safely.",
  unsupported_response_type: "This app asked for a response type Egg does not support.",
  invalid_scope: "This app asked for a permission it is not registered to use.",
  access_denied: "You denied this request. Nothing was shared with the app.",
};

const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function ErrorState({ code, detail }: { code: string; detail?: string }) {
  return (
    <div className="motion-enter mx-auto max-w-[640px] space-y-4">
      <PageHeader title="Can't authorize this app" description="No access was granted." />
      <Alert tone="error" title={ERROR_MESSAGES[code] ?? "This authorization request could not be completed."}>
        {detail ? <p className="text-muted-foreground">{detail}</p> : null}
        <p className="text-muted-foreground">
          You can close this window, or{" "}
          <Link href="/account" className="link font-medium">
            go back to your account
          </Link>
          .
        </p>
      </Alert>
    </div>
  );
}

/**
 * Consent screen for the OAuth authorization-code flow. Every value is
 * re-checked against the registered client before it is shown — the page is
 * reachable directly, not only through /api/oauth/authorize.
 */
export default async function OAuthConsentPage({ searchParams }: PageProps) {
  // Session and (indirectly) the clock decide what renders, so this is request-time work.
  await connection();
  const params = await searchParams;

  const user = await getCurrentUser();
  if (!user) {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string") next.set(key, value);
    }
    redirect(`/login?next=${encodeURIComponent(`/oauth/consent?${next.toString()}`)}`);
  }

  const error = first(params.error);
  if (error) return <ErrorState code={error} />;

  const clientId = first(params.client_id);
  if (!clientId) return <ErrorState code="invalid_request" />;

  const row = await getClient(clientId);
  if (!row) return <ErrorState code="invalid_client" />;
  const client = summarizeClient(row);

  let redirectUri: string;
  try {
    redirectUri = validateRedirectUri(first(params.redirect_uri), client.redirectUris);
  } catch {
    return <ErrorState code="invalid_redirect_uri" />;
  }

  const scopeParam = first(params.scope);
  if (!scopeParam) return <ErrorState code="invalid_scope" />;
  const scopes = [...new Set(scopeParam.split(/\s+/).filter(Boolean))];
  const known = MCP_SCOPES as readonly string[];
  if (scopes.length === 0 || scopes.some((scope) => !known.includes(scope))) {
    return <ErrorState code="invalid_scope" />;
  }
  if (scopes.some((scope) => !(client.scopes as readonly string[]).includes(scope))) {
    return <ErrorState code="invalid_scope" />;
  }

  const state = first(params.state);
  if (!state || state.length > 512) return <ErrorState code="invalid_request" />;

  const codeChallengeMethod = first(params.code_challenge_method) ?? "S256";
  const codeChallenge = first(params.code_challenge);
  if (codeChallengeMethod !== "S256" || !codeChallenge || !CHALLENGE_RE.test(codeChallenge)) {
    return <ErrorState code="invalid_request" />;
  }

  return (
    <div className="motion-enter mx-auto max-w-[640px]">
      <PageHeader
        title="Authorize an app"
        description={`Signed in as ${user.email ?? user.name}. Review the request below.`}
      />
      <OAuthConsent
        clientName={client.name}
        clientHost={redirectHost(redirectUri)}
        redirectUri={redirectUri}
        scopes={scopes}
        fields={{
          client_id: client.clientId,
          redirect_uri: redirectUri,
          response_type: "code",
          scope: scopes.join(" "),
          state,
          code_challenge: codeChallenge,
          code_challenge_method: "S256",
        }}
      />
    </div>
  );
}
