import { z } from "zod";
import { authed, handle, ok, readJson } from "@/server/http";
import { getBuildCpu, getBuildMemory, setBuildCpu, setBuildMemory } from "@/server/build-memory";

type Ctx = { params: Promise<{ id: string }> };

/** Memory and CPU limits are independently optional, but unknown keys are refused. */
const body = z
  .object({ memoryMb: z.number().optional(), cpuCores: z.number().optional() })
  .strict()
  .refine((v) => Number(v.memoryMb !== undefined) + Number(v.cpuCores !== undefined) === 1);

/** The build memory of one of the signed-in user's servers, with its allowed range. */
export const GET = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id } = await params;
  const [buildMemory, buildCpu] = await Promise.all([getBuildMemory(user.id, id), getBuildCpu(user.id, id)]);
  return ok({ buildMemory, buildCpu });
});

/** Change the build memory of one server. */
export const PUT = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { id } = await params;
  const value = await readJson(req, body);
  const result = value.memoryMb !== undefined
    ? { buildMemory: await setBuildMemory(user.id, id, value.memoryMb) }
    : { buildCpu: await setBuildCpu(user.id, id, value.cpuCores!) };
  const [buildMemory, buildCpu] = await Promise.all([getBuildMemory(user.id, id), getBuildCpu(user.id, id)]);
  return ok({ buildMemory, buildCpu, ...result });
});
