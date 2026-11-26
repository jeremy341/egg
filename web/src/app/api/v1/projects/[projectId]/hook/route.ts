import { v1Route } from "@/server/api-v1-http";

export const GET = v1Route("list_deploy_webhook_tokens");
export const DELETE = v1Route("revoke_deploy_hook");
