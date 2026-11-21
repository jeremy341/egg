import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/server/auth/current";
import { verifyOAuthStateBinding } from "@/server/auth/oauth-state";
import { config } from "@/server/config";
import { safeEqual } from "@/server/crypto";
import { installationsForCode, saveInstallations } from "@/server/github/app";
import { maintenanceBlocksUser } from "@/server/maintenance";

function back(status: string) {
  const res = NextResponse.redirect(new URL(`/new?github=${status}`, config().APP_URL), 303);
  res.cookies.delete({ name: "egg_gh_state", path: "/" });
  return res;
}

/** GitHub sends the user here after they authorize or install the App. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", config().APP_URL), 303);
  if (await maintenanceBlocksUser(user.id)) {
    return NextResponse.json({ error: { code: "maintenance", message: "GitHub linking is paused during maintenance. Connect it again after the window ends." } }, { status: 503, headers: { "Retry-After": "60" } });
  }

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const cookies = req.cookies.getAll("egg_gh_state");
  const header = req.headers.get("cookie") ?? "";
  const repeated = header.split(";").filter((part) => part.trimStart().startsWith("egg_gh_state=")).length > 1;
  // Two cookies with this name mean one was planted. RequestCookies keeps only
  // the last, so also count them in the raw header before it can decide for us.
  if (cookies.length > 1 || repeated) return back("invalid_state");
  const raw = cookies[0]?.value;
  const saved = raw ? verifyOAuthStateBinding(user.id, raw) : null;
  if (!code || !state || !saved || !safeEqual(saved, state)) return back("invalid_state");

  try {
    await saveInstallations(user.id, await installationsForCode(code));
    return back("connected");
  } catch (err) {
    console.error("GitHub link failed", err);
    return back("failed");
  }
}
