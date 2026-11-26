import { authed, handle, ok } from "@/server/http";
import { lastCrash } from "@/server/crash";

type Ctx = { params: Promise<{ id: string }> };

/** The last crash the monitor recorded (status and reason only), or `{ crash: null }`. Reads the database only. */
export const GET = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id } = await params;
  return ok({ crash: await lastCrash(user.id, id) });
});
