import { authed, handle, ok } from "@/server/http";
import { inspectRecovery } from "@/server/operator-recovery";
export const GET = handle(async () => {
  const user = await authed();
  const res = ok({ guards: await inspectRecovery(user.id) });
  res.headers.set("Cache-Control", "no-store");
  return res;
});
