import { authed, handle, ok, readJson } from "@/server/http";
import { z } from "zod";
import { createConnection, listConnections } from "@/server/providers/connections";

const body = z.object({ provider: z.enum(["gitlab", "forgejo", "codeberg"]), label: z.string(), host: z.string(), accessToken: z.string() });
export const GET = handle(async () => ok({ connections: await listConnections((await authed()).id) }));
export const POST = handle(async (req) => {
  const user = await authed();
  return ok({ connection: await createConnection(user.id, await readJson(req, body)) }, 201);
});
