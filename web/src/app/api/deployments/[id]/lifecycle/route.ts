import { z } from "zod";
import { authed, handle, ok, readJson } from "@/server/http";
import { deploymentVolumes, operateDeployment } from "@/server/deploy/lifecycle";

type Ctx = { params: Promise<{ id: string }> };

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["start", "stop", "restart"]), }).strict(),
  z.object({
    action: z.literal("scale"),
    memoryMb: z.number().int().min(128).max(32768).optional(),
    cpuPercent: z.number().int().min(1).max(6400).optional(),
  }).strict(),
]);

export const GET = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id } = await params;
  return ok(await deploymentVolumes(user.id, id));
});

export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { id } = await params;
  const input = await readJson(req, inputSchema);
  return ok(await operateDeployment(user.id, id, input));
});
