import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

export type ProviderKind = "github" | "gitlab" | "forgejo" | "codeberg" | "git";
export type Headers = Readonly<Record<string, string | undefined>>;
export type ProviderCapabilities = Readonly<{
  manualDeploy: boolean; deployHook: boolean; webhook: boolean;
  repositoryDiscovery: boolean; pullRequests: boolean; commitChecks: boolean;
}>;
export type Provider = Readonly<{ kind: ProviderKind; defaultHost: string | null; capabilities: ProviderCapabilities }>;

const basic: ProviderCapabilities = { manualDeploy: true, deployHook: true, webhook: false, repositoryDiscovery: false, pullRequests: false, commitChecks: false };
// Discovery, previews, and checks remain disabled until implemented and confirmed per instance.
const hosted: ProviderCapabilities = { ...basic, webhook: true };
const providers: Record<ProviderKind, Provider> = {
  github: { kind: "github", defaultHost: "github.com", capabilities: hosted },
  gitlab: { kind: "gitlab", defaultHost: "gitlab.com", capabilities: hosted },
  forgejo: { kind: "forgejo", defaultHost: null, capabilities: hosted },
  codeberg: { kind: "codeberg", defaultHost: "codeberg.org", capabilities: hosted },
  git: { kind: "git", defaultHost: null, capabilities: basic },
};
export function getProvider(kind: ProviderKind): Provider { return providers[kind]; }

/** Lexical validation only. At connection time the caller must resolve and reject private,
 * loopback, link-local and other non-public IP addresses, including on redirects, and pin
 * the checked address; DNS rebinding cannot be prevented by URL validation alone. */
export function validateCloneUrl(kind: ProviderKind, input: string): string {
  if (input !== input.trim() || /[\u0000-\u0020\u007f\\]/.test(input)) throw new Error("Invalid clone URL");
  const scp = /^git@([^/:]+):(.+)$/.exec(input);
  const raw = scp ? `ssh://git@${scp[1]}/${scp[2]}` : input;
  if (/(?:^|\/)\.{1,2}(?:\/|$|[?#])/i.test(raw) || /%2e|%2f|%5c/i.test(raw)) throw new Error("Invalid repository path");
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("Invalid clone URL"); }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || isIP(host.replace(/^\[|\]$/g, "")) || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || !host.includes(".")) throw new Error("Invalid clone host");
  if (url.protocol !== "https:" && url.protocol !== "ssh:") throw new Error("Unsupported clone protocol");
  if (url.password || (url.username && !(url.protocol === "ssh:" && url.username === "git")) || url.search || url.hash || url.pathname === "/") throw new Error("Invalid clone URL");
  if ((kind === "github" || kind === "codeberg") && host !== providers[kind].defaultHost) throw new Error("Unexpected provider host");
  // GitLab and Forgejo may be self-hosted. The stored instance identity must be matched separately.
  return url.toString();
}

export type FetchRequest = { visibility: "public" } | { visibility: "private"; credentialId: string };
export type FetchAuthorization = { kind: "public" } | { kind: "credential"; credentialId: string };
/** The injected check must bind the credential to this actor, provider, repository and operation. */
export async function authorizeFetch(request: FetchRequest, isAuthorized: (credentialId: string) => Promise<boolean>): Promise<FetchAuthorization> {
  if (request.visibility === "public") return { kind: "public" };
  if (!request.credentialId || !(await isAuthorized(request.credentialId))) throw new Error("Repository credential is not authorized");
  return { kind: "credential", credentialId: request.credentialId };
}

function header(headers: Headers, name: string): string | undefined {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  return entry?.[1];
}
function equal(a: string, b: string): boolean {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
/** Verify the exact raw body before JSON parsing. Secrets must be loaded from protected storage. */
export function verifyWebhook(kind: ProviderKind, body: string | Buffer, headers: Headers, secret: string): boolean {
  if (!secret || kind === "git") return false;
  if (kind === "gitlab") return equal(header(headers, "x-gitlab-token") ?? "", secret);
  const digest = createHmac("sha256", secret).update(body).digest("hex");
  if (kind === "github") return equal(header(headers, "x-hub-signature-256") ?? "", `sha256=${digest}`);
  const sig = header(headers, "x-forgejo-signature") ?? header(headers, "x-gitea-signature") ?? "";
  return equal(sig, digest);
}

export type PushEvent = { deliveryId: string; repository: string; branch: string; commit: string };
/** Only call after signature verification; event delivery IDs must be deduplicated persistently. */
export function normalizePush(kind: ProviderKind, headers: Headers, body: string | Buffer): PushEvent | null {
  if (kind === "git") return null;
  const github = kind === "github"; const gitlab = kind === "gitlab";
  const event = header(headers, github ? "x-github-event" : gitlab ? "x-gitlab-event" : "x-forgejo-event") ?? (!github && !gitlab ? header(headers, "x-gitea-event") : undefined);
  const deliveryId = header(headers, github ? "x-github-delivery" : gitlab ? "x-gitlab-event-uuid" : "x-forgejo-delivery") ?? (!github && !gitlab ? header(headers, "x-gitea-delivery") : undefined);
  if (event !== (gitlab ? "Push Hook" : "push") || !deliveryId || deliveryId.length > 256) return null;
  let value: unknown;
  try { value = JSON.parse(body.toString()); } catch { return null; }
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const repo = data.repository && typeof data.repository === "object" ? data.repository as Record<string, unknown> : {};
  const project = data.project && typeof data.project === "object" ? data.project as Record<string, unknown> : {};
  const repository = gitlab ? project.path_with_namespace : repo.full_name;
  if (typeof repository !== "string" || !/^[^\s/]+(?:\/[^\s/]+)+$/.test(repository) || typeof data.ref !== "string" || !data.ref.startsWith("refs/heads/") || data.ref.length <= 11 || typeof data.after !== "string" || !/^[a-f0-9]{40}$/i.test(data.after) || /^0+$/.test(data.after)) return null;
  return { deliveryId, repository, branch: data.ref.slice(11), commit: data.after };
}

export function verifiedPush(kind: ProviderKind, headers: Headers, body: string | Buffer, secret: string): PushEvent | null {
  return verifyWebhook(kind, body, headers, secret) ? normalizePush(kind, headers, body) : null;
}


