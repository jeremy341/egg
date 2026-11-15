import { authed, handle, ok } from "@/server/http";
import { listSecurityReports } from "@/server/security-reports";
export const GET = handle(async () => {
  const res = ok({ reports: await listSecurityReports((await authed()).id) });
  res.headers.set("Cache-Control", "private, no-store");
  return res;
});
