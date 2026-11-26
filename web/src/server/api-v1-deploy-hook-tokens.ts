import { z } from "zod";
import { requireScope, type Principal } from "@/server/api-tokens";
import { tagAudit } from "@/server/api-v1-audit";
import { endpoint, NOT_FOUND_NOTE, projectIdInput, type Endpoint } from "@/server/api-v1-kit";
import { createDeployHookToken, deleteDeployHookToken } from "@/server/hooks";
import { HttpError } from "@/server/http";

const tokenId = z.string().trim().min(1).max(100).describe("The deploy-hook token id from list_deploy_webhook_tokens.");
const tokenName = z.string().trim().min(1, "Give the deploy-hook token a name.").max(100);

export async function apiCreateDeployWebhookToken(p: Principal, projectId: string, name: string) {
  requireScope(p, "deployments:write");
  const token = await tagAudit(
    p,
    "hook.create",
    () => createDeployHookToken(p.userId, projectId, name),
    { name }
  );
  return {
    token: {
      id: token.id,
      name: token.name,
      secret: token.token,
      createdAt: token.createdAt.toISOString(),
    },
  };
}

export async function apiDeleteDeployWebhookToken(
  p: Principal,
  projectId: string,
  id: string,
  confirmName: string
) {
  requireScope(p, "deployments:write");
  if (!confirmName) throw new HttpError(400, "Type the exact token name to confirm.", "confirmation_failed");
  return tagAudit(
    p,
    "hook.revoke",
    () => deleteDeployHookToken(p.userId, projectId, id, confirmName),
    { name: confirmName }
  );
}

export const DEPLOY_HOOK_TOKEN_ENDPOINTS: Endpoint[] = [
  endpoint({
    id: "create_deploy_webhook_token",
    method: "POST",
    path: "/projects/{projectId}/hook/tokens",
    scope: "deployments:write",
    bucket: "write",
    sensitive: true,
    status: 201,
    tag: "Deployments",
    summary: "Create a named deploy-hook token",
    description: `Create a named deploy-hook token for this project. Its secret is returned ONCE; store it securely. Send POST requests to /api/hooks/deploy/{secret} to start deployments. The token works independently of the project's legacy hook. ${NOT_FOUND_NOTE}`,
    pathParams: { projectId: projectIdInput },
    body: { name: tokenName.describe("A required name used to identify and confirm deletion of this token.") },
    response: z.object({
      token: z.object({
        id: z.string(),
        name: z.string(),
        secret: z.string().describe("The one-time deploy-hook secret. Shown only in this response."),
        createdAt: z.string(),
      }),
    }),
    errors: [400, 404],
    untrusted: false,
    run: (p, i) => apiCreateDeployWebhookToken(p, i.projectId, i.name),
  }),
  endpoint({
    id: "delete_deploy_webhook_token",
    method: "DELETE",
    path: "/projects/{projectId}/hook/tokens/{tokenId}",
    scope: "deployments:write",
    bucket: "write",
    tag: "Deployments",
    summary: "Delete a named deploy-hook token",
    description: `Delete a named deploy-hook token. The body must set confirmName to the token's exact name. This cannot be undone; clients using the secret will stop deploying. ${NOT_FOUND_NOTE}`,
    pathParams: { projectId: projectIdInput, tokenId },
    body: { confirmName: z.string().min(1).max(100).describe("The token's exact name, from list_deploy_webhook_tokens.") },
    response: z.object({ deleted: z.literal(true), tokenId: z.string(), projectId: z.string() }),
    errors: [400, 404],
    destructive: true,
    run: (p, i) => apiDeleteDeployWebhookToken(p, i.projectId, i.tokenId, i.confirmName),
  }),
];
