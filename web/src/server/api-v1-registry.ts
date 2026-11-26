import { z } from "zod";
import { requireScope, type Principal } from "@/server/api-tokens";
import { tagAudit } from "@/server/api-v1-audit";
import { endpoint, type Endpoint } from "@/server/api-v1-kit";
import { HttpError, notFound } from "@/server/http";
import {
  createRegistryCredential,
  listRegistryCredentials,
  registryCreateInput,
  removeRegistryCredential,
  updateRegistryCredential,
} from "@/server/registry";

/**
 * Registry logins in the public API. The service layer in `registry.ts` seals
 * the password with the instance key and never returns it or its sealed form;
 * this module only maps its safe view into API responses. It deliberately never
 * calls `registryLoginFor`, which is for the deploy step alone.
 *
 * No dedicated scope exists for registry logins. They are owner-wide secret
 * configuration like environment variables, so reading them needs `env:read`
 * and changing or deleting them needs `env:write`.
 */

type RegistryView = Awaited<ReturnType<typeof listRegistryCredentials>>[number];

/** Copy only the safe fields, so a secret added to the service view later cannot leak here. */
function publicCredential(credential: RegistryView) {
  return {
    id: credential.id,
    host: credential.host,
    username: credential.username,
    usedBy: credential.usedBy.map((app) => ({ id: app.id, name: app.name })),
    createdAt: credential.createdAt,
    updatedAt: credential.updatedAt,
  };
}

const credentialSchema = z.object({
  id: z.string(),
  host: z.string(),
  username: z.string(),
  usedBy: z.array(z.object({ id: z.string(), name: z.string() })).describe("The owner's image apps that pull with this login."),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const credentialId = z.string().trim().min(1).max(64).describe("The login id, from list_registry_credentials.");

export async function apiListRegistryCredentials(p: Principal) {
  requireScope(p, "env:read");
  return { credentials: (await listRegistryCredentials(p.userId)).map(publicCredential) };
}

/** Create a login for a host, or replace the username and password of the owner's existing login for it. */
export async function apiSetRegistryCredential(p: Principal, input: z.output<typeof registryCreateInput>) {
  requireScope(p, "env:write");
  const host = input.host.trim().toLowerCase();
  const existing = (await listRegistryCredentials(p.userId)).find((credential) => credential.host === host);
  const credential: RegistryView = existing
    ? await tagAudit(
        p,
        "registry.update",
        () => updateRegistryCredential(p.userId, existing.id, { username: input.username, password: input.password }),
        { host: existing.host, fields: "username, password" }
      )
    : await tagAudit(
        p,
        "registry.create",
        () => createRegistryCredential(p.userId, input),
        { host }
      );
  // The password is write-only: only the safe view goes back.
  return { credential: publicCredential(credential) };
}

export async function apiDeleteRegistryCredential(p: Principal, id: string, confirmName: string) {
  requireScope(p, "env:write");
  const credential = (await listRegistryCredentials(p.userId)).find((row) => row.id === id);
  if (!credential) throw notFound("Registry login not found");
  if (confirmName !== credential.host) {
    throw new HttpError(400, "Confirmation must exactly match the registry host.", "confirmation_failed");
  }
  await tagAudit(p, "registry.remove", () => removeRegistryCredential(p.userId, id), { host: credential.host });
  return { deleted: true, credentialId: id };
}

export const REGISTRY_ENDPOINTS: Endpoint[] = [
  endpoint({
    id: "list_registry_credentials",
    method: "GET",
    path: "/registry-credentials",
    scope: "env:read",
    bucket: "read",
    tag: "Environment",
    summary: "List registry logins",
    description:
      "List the token owner's private-registry logins, with each host, username, id and the image apps that use it. Passwords are stored encrypted and are never returned, not even in sealed form; this app has no way to read one back. Egg has no organization-wide logins: every login belongs to the token owner.",
    response: z.object({ credentials: z.array(credentialSchema) }),
    errors: [400],
    run: (p) => apiListRegistryCredentials(p),
  }),
  endpoint({
    id: "set_registry_credential",
    method: "PUT",
    path: "/registry-credentials",
    scope: "env:write",
    bucket: "write",
    sensitive: true,
    tag: "Environment",
    summary: "Set a registry login",
    description:
      "Create a login for a private image registry, or replace the username and password of your existing login for that host. The host must be a registry host without a scheme or path. The password is write-only: it is sealed at rest and is never returned by any endpoint, so keep a copy before changing it. A login is used by your image apps whose images are on the same host.",
    body: {
      host: registryCreateInput.shape.host.describe("The registry host only, for example ghcr.io or registry.example.com:5000. No scheme or path."),
      username: registryCreateInput.shape.username.describe("The registry username. Write-only; never returned."),
      password: registryCreateInput.shape.password.describe("The registry password or token. Write-only; never returned."),
    },
    response: z.object({ credential: credentialSchema }),
    errors: [400, 409],
    run: (p, i) => apiSetRegistryCredential(p, i),
  }),
  endpoint({
    id: "delete_registry_credential",
    method: "DELETE",
    path: "/registry-credentials/{credentialId}",
    scope: "env:write",
    bucket: "write",
    tag: "Environment",
    summary: "Delete a registry login",
    description:
      "Permanently remove one registry login. confirmName must exactly match the host shown by list_registry_credentials. A login still used by one of your image apps cannot be deleted: point those apps at another login or at none first. No password is returned.",
    pathParams: { credentialId },
    body: { confirmName: z.string().min(1).max(261).describe("The exact registry host to confirm this action.") },
    response: z.object({ deleted: z.boolean(), credentialId: z.string() }),
    errors: [400, 404, 409],
    destructive: true,
    run: (p, i) => apiDeleteRegistryCredential(p, i.credentialId, i.confirmName),
  }),
];
