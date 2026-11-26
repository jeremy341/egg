import { NextResponse } from "next/server";
import { deleteTheme, getTheme, updateTheme } from "@/server/custom-themes";
import { authed, handle, notFound } from "@/server/http";
import { NO_STORE, readThemeBody, saveResponse } from "@/server/theme-http";

type Ctx = { params: Promise<{ id: string }> };

/** A theme id is short, lower-case letters, digits and dashes. Anything else cannot exist. */
const ID = /^[a-z0-9-]{8,40}$/;

async function themeId(ctx: Ctx) {
  const { id } = await ctx.params;
  if (!ID.test(id)) throw notFound("Theme not found");
  return id;
}

/** One of the signed-in person's themes. Someone else's, or an unknown id, is a 404. */
export const GET = handle<Ctx>(async (_req, ctx) => {
  const user = await authed();
  return NextResponse.json({ theme: await getTheme(user.id, await themeId(ctx)) }, { headers: NO_STORE });
});

/** Replace a theme (`{ name, scheme, tokens }`), under the same rules as creating one. */
export const PUT = handle<Ctx>(async (req, ctx) => {
  const user = await authed();
  const id = await themeId(ctx);
  return saveResponse(await updateTheme(user.id, id, await readThemeBody(req)), 200);
});

/** Delete a theme. A choice that used it goes back to Egg Light or Egg Dark. */
export const DELETE = handle<Ctx>(async (_req, ctx) => {
  const user = await authed();
  await deleteTheme(user.id, await themeId(ctx));
  return NextResponse.json({ deleted: true }, { headers: NO_STORE });
});
