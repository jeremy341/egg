import { NextResponse } from "next/server";
import { createTheme, listThemes } from "@/server/custom-themes";
import { authed, handle } from "@/server/http";
import { NO_STORE, readThemeBody, saveResponse } from "@/server/theme-http";

/** The signed-in person's custom themes, oldest first. Never cached. */
export const GET = handle(async () => {
  const user = await authed();
  return NextResponse.json({ themes: await listThemes(user.id) }, { headers: NO_STORE });
});

/**
 * Create a theme from `{ name, scheme, tokens }`. Same-origin is checked by
 * handle(). 400 for a bad name, scheme or colour (only `#` and 3, 4, 6 or 8 hex
 * digits), 409 past 20 themes, 422 when body text on the page or a card is under
 * 4.5:1 (the answer names the pair, the ratio and a colour that passes).
 */
export const POST = handle(async (req) => {
  const user = await authed();
  return saveResponse(await createTheme(user.id, await readThemeBody(req)), 201);
});
