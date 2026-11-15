import { authed, handle, ok } from "@/server/http";
import { maintenanceState } from "@/server/maintenance";

export const GET = handle(async () => {
  await authed();
  const res = ok({ maintenance: await maintenanceState() });
  res.headers.set("Cache-Control", "no-store");
  return res;
});
