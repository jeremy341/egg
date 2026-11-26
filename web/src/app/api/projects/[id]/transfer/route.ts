import { z } from "zod";
import { authed, handle, ok, readJson } from "@/server/http";
import { requestTransfer } from "@/server/ownership-transfer";

type Ctx = { params: Promise<{ id: string }> };

/** The owner asks to hand the project to a project member. The member must accept. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { id } = await params;
  const body = await readJson(req, z.object({ toUserId: z.string().min(1).max(64) }));
  return ok({ transfer: await requestTransfer(user.id, id, body.toUserId) }, 201);
});
