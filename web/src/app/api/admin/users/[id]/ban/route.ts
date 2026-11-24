import type { NextRequest } from "next/server";
import { z } from "zod";
import { banUser } from "@/server/admin-users";
import { SESSION_COOKIE, isFreshAuth } from "@/server/auth/session";
import { authed, handle, ok, readJson } from "@/server/http";
import { enforceRateLimit } from "@/server/rate-limit";

type Ctx = { params: Promise<{ id: string }> };

/** Ban an account, with a reason. The account keeps working for 15 days. Needs a fresh Hack Club sign-in. */
export const POST = handle(async (req: NextRequest, { params }: Ctx) => {
  const user = await authed();
  enforceRateLimit("adminGrant", user.id);
  const body = await readJson(req, z.unknown());
  const fresh = await isFreshAuth(req.cookies.get(SESSION_COOKIE)?.value, Date.now(), user.id);
  return ok(await banUser(user.id, (await params).id, body, fresh));
});
