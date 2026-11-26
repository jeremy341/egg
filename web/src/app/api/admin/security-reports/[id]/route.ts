import { type NextRequest } from "next/server";
import { authed, handle, ok } from "@/server/http";
import { readJsonLimited } from "@/server/body-limit";
import {
  deleteSecurityReport,
  getSecurityReport,
  updateSecurityReport,
} from "@/server/security-reports";
import { z } from "zod";
type Ctx = { params: Promise<{ id: string }> };
export const GET = handle(async (_req: NextRequest, { params }: Ctx) => {
  const r = await getSecurityReport((await authed()).id, (await params).id);
  const res = ok({
    ...r,
    payload: {
      ...r.payload,
      evidence: r.payload.evidence.map(({ name, type }) => ({ name, type })),
    },
  });
  res.headers.set("Cache-Control", "private, no-store");
  return res;
});
export const PATCH = handle(async (req: NextRequest, { params }: Ctx) => {
  const body = z
    .object({ status: z.enum(["new", "reviewing", "resolved"]) })
    .parse(await readJsonLimited(req, { maxBytes: 1024 }));
  await updateSecurityReport(
    (await authed()).id,
    (await params).id,
    body.status,
  );
  return ok({ updated: true });
});
export const DELETE = handle(async (_req: NextRequest, { params }: Ctx) => {
  await deleteSecurityReport((await authed()).id, (await params).id);
  return ok({ deleted: true });
});
