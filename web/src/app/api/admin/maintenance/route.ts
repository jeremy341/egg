import { authed, handle, ok } from "@/server/http";
import { readJsonLimited } from "@/server/body-limit";
import { saveMaintenance } from "@/server/maintenance";

export const PUT = handle(async (req) => {
  const user = await authed();
  const res = ok({ maintenance: await saveMaintenance(user.id, await readJsonLimited(req)) });
  res.headers.set("Cache-Control", "no-store");
  return res;
});
