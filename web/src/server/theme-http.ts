import { NextResponse } from "next/server";
import { readTextLimited } from "@/server/body-limit";
import type { SaveResult } from "@/server/custom-themes";
import { HttpError } from "@/server/http";

export const NO_STORE = { "Cache-Control": "no-store" };

/** A theme is about 2 KB of JSON; anything over 8 KB is not one. */
export const THEME_BODY_MAX = 8_192;

export async function readThemeBody(req: Request): Promise<unknown> {
  try {
    return JSON.parse(await readTextLimited(req, THEME_BODY_MAX));
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, "Request body must be JSON", "bad_json");
  }
}

/** The answer for a save: 422 with the failing body-text pairs, or the saved theme and any warnings. */
export function saveResponse(result: SaveResult, status: number) {
  if (!result.ok) {
    return NextResponse.json(
      { error: { code: "contrast", message: result.message, pairs: result.blocking } },
      { status: 422, headers: NO_STORE }
    );
  }
  return NextResponse.json({ theme: result.theme, warnings: result.warnings }, { status, headers: NO_STORE });
}
