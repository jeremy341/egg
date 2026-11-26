import { z } from "zod";
import { authed, handle, ok, readJson } from "@/server/http";
import { getBuildMemory, setBuildMemory } from "@/server/build-memory";

type Ctx = { params: Promise<{ id: string }> };

/** Only the memory, only a number. The range depends on the server, so it is checked against the server. */
const body = z.object({ memoryMb: z.number() }).strict();

/** The build memory of one of the signed-in user's servers, with its allowed range. */
export const GET = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id } = await params;
  return ok({ buildMemory: await getBuildMemory(user.id, id) });
});

/** Change the build memory of one server. */
export const PUT = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { id } = await params;
  const { memoryMb } = await readJson(req, body);
  return ok({ buildMemory: await setBuildMemory(user.id, id, memoryMb) });
});
