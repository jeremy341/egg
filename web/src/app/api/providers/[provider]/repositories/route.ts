import { z } from "zod";
import { authed, handle, HttpError, ok } from "@/server/http";
import { providerClientForUser } from "@/server/providers/connections";
const provider = z.enum(["gitlab", "forgejo", "codeberg"]);
export const GET = handle(async (req, ctx: { params: Promise<{ provider: string }> }) => {
  const user = await authed(); const kind = provider.safeParse((await ctx.params).provider);
  const connectionId = req.nextUrl.searchParams.get("connectionId");
  if (!kind.success || !connectionId || connectionId.length > 64) throw new HttpError(400, "Invalid provider connection.", "validation");
  const client = await providerClientForUser(user.id, connectionId, kind.data);
  const repositories = [];
  try {
    let page: number | null = 1;
    for (let count = 0; page !== null && count < 20; count++) { const result = await client.listRepositories(page); repositories.push(...result.repositories); page = result.nextPage; }
    if (page !== null) throw new Error("Repository list exceeds limit");
  } catch { throw new HttpError(502, "Could not list repositories. Check the provider connection.", "provider_unavailable"); }
  return ok({ repositories });
});
