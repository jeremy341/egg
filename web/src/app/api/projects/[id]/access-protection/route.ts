import { NextResponse } from "next/server";
import { ACCESS_SESSION_COOKIE, ACCESS_SESSION_TTL_SECONDS, accessSettingsInput, getAccessSettings, getProjectAccessMode, issueAccessSession, saveAccessSettings } from "@/server/access-protection";
import { authed, handle, ok, readJson } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

/** Owners only: read whether protection is set without disclosing the credential. */
export const GET = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id } = await params;
  return ok(await getAccessSettings(user.id, id));
});

/** Owners only: save access mode, excluded paths, and an optional replacement password. */
export const PUT = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { id } = await params;
  const body = await readJson(req, accessSettingsInput);
  return ok(await saveAccessSettings(user.id, id, body));
});

/** Signed-in Egg users may mint a project session only when the owner enabled Egg sign-in. */
export const POST = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id } = await params;
  if (await getProjectAccessMode(id) !== "sign_in") return ok({ ok: false }, 409);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(ACCESS_SESSION_COOKIE, issueAccessSession(id, user.id), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ACCESS_SESSION_TTL_SECONDS,
  });
  return response;
});
