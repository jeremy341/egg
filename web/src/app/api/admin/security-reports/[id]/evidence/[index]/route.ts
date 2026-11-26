import { type NextRequest } from "next/server";
import { authed, handle, notFound } from "@/server/http";
import { getSecurityReport } from "@/server/security-reports";
type Ctx = { params: Promise<{ id: string; index: string }> };
export const GET = handle(async (_req: NextRequest, { params }: Ctx) => {
  const { id, index } = await params;
  const report = await getSecurityReport((await authed()).id, id);
  if (!/^[0-2]$/.test(index)) throw notFound("Evidence not found");
  const image = report.payload.evidence[Number(index)];
  if (!image) throw notFound("Evidence not found");
  return new Response(new Uint8Array(Buffer.from(image.data, "base64")), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="evidence-${Number(index) + 1}.${image.type === "image/png" ? "png" : "jpg"}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
});
