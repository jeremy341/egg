import { readJsonLimited } from "@/server/body-limit";
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/server/auth/session";
import { deleteAccount } from "@/server/account";
import { authed, handle } from "@/server/http";

/** Delete the account. The body must carry the user's name as confirmation. */
export const DELETE = handle(async (req) => {
  const user = await authed();
  const body = (await readJsonLimited(req, { fallback: {} })) as { confirm?: unknown };
  await deleteAccount(user.id, user.name, body.confirm);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
});
