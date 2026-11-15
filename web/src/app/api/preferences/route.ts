import { NextResponse } from "next/server";
import { appearanceCookie } from "@/lib/preferences";
import { readTextLimited } from "@/server/body-limit";
import { cookieThemes } from "@/server/custom-themes";
import { authed, handle, HttpError, ok } from "@/server/http";
import { getPreferences, updatePreferences } from "@/server/preferences";

/** The signed-in person's saved preferences. Never cached. */
export const GET = handle(async () => {
  const user = await authed();
  const res = NextResponse.json({ preferences: await getPreferences(user.id) });
  res.headers.set("Cache-Control", "no-store");
  return res;
});

/**
 * Save part of the preferences. Same-origin is checked by handle(); the body
 * is capped because nothing here needs more than a few hundred bytes. The
 * response sets egg_prefs too, so a new device gets the look before paint.
 */
export const PATCH = handle(async (req) => {
  const user = await authed();
  let body: unknown;
  try {
    body = JSON.parse(await readTextLimited(req, 4_096));
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, "Request body must be JSON", "bad_json");
  }
  const preferences = await updatePreferences(user.id, body);
  const res = ok({ preferences });
  res.headers.set("Cache-Control", "no-store");
  res.headers.append(
    "Set-Cookie",
    // A custom theme in use travels in the cookie too, so first paint has its colours (see serializeAppearance).
    appearanceCookie(preferences, req.nextUrl.protocol === "https:", await cookieThemes(user.id))
  );
  return res;
});
