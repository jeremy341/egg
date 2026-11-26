import { z } from "zod";
import { readJsonLimited } from "@/server/body-limit";
import { authed, handle, ok, zodToHttp } from "@/server/http";
import { HOST_KEY_FINGERPRINT, getServerForUser, publicServer, testServer } from "@/server/servers";

type Ctx = { params: Promise<{ id: string }> };

/** The body is optional. `confirmHostKey` is the fingerprint the owner was shown and agreed to. */
const body = z.object({
  confirmHostKey: z.string().regex(HOST_KEY_FINGERPRINT, "That is not a SHA256 host key fingerprint").optional(),
});

/**
 * Connect over SSH and report what the container supports. The first time, the
 * host key is shown for confirmation and nothing is pinned until the owner sends
 * it back as `confirmHostKey`.
 */
export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { id } = await params;
  const parsed = body.safeParse(await readJsonLimited(req, { fallback: {} }));
  if (!parsed.success) throw zodToHttp(parsed.error);
  const result = await testServer(user.id, id, { confirmHostKey: parsed.data.confirmHostKey });
  const server = publicServer(await getServerForUser(user.id, id));
  return ok({ result, server });
});
