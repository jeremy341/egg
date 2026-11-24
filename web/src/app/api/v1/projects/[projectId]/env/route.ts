import { v1Route } from "@/server/api-v1-http";

export const GET = v1Route("list_env_vars");
export const POST = v1Route("add_env_vars");
export const PUT = v1Route("set_env_vars");
export const DELETE = v1Route("delete_env_vars");
