import { z } from "zod";
import { readJsonLimited } from "@/server/body-limit";
import { deleteRule, setRulePaused } from "@/server/alert-rules";
import { authed, handle, ok } from "@/server/http";

type Ctx = { params: Promise<{ id: string; ruleId: string }> };

const patchInput = z.object({ paused: z.boolean() });

/** Pause or resume a rule. */
export const PATCH = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { id, ruleId } = await params;
  const { paused } = patchInput.parse(await readJsonLimited(req, { fallback: {} }));
  return ok({ rule: await setRulePaused(user.id, id, ruleId, paused) });
});

export const DELETE = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id, ruleId } = await params;
  await deleteRule(user.id, id, ruleId);
  return ok({ ok: true });
});
