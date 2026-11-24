import { readJsonLimited } from "@/server/body-limit";
import { createRule, listRules } from "@/server/alert-rules";
import { authed, handle, ok } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

/** The app's threshold rules, with their current status. */
export const GET = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id } = await params;
  return ok({ rules: await listRules(user.id, id) });
});

/** Add a rule. An app can have 25 at most. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { id } = await params;
  const body = await readJsonLimited(req, { fallback: {} });
  return ok({ rule: await createRule(user.id, id, body) });
});
