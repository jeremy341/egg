import { NextResponse } from "next/server";
import {
  buildCredentialInfoForUser,
  createBuildCredentialsForUser,
  revokeBuildCredentialsForUser,
} from "@/server/builds/token";
import { authed, handle, ok } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Make the three build credentials for GitHub builds (upload, preview variables, production variables),
 * replacing any earlier set. The tokens are returned once and only their hashes are stored.
 */
export const POST = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id } = await params;
  const made = await createBuildCredentialsForUser(user.id, id);
  return NextResponse.json(
    {
      uploadToken: made.uploadToken,
      previewEnvToken: made.previewEnvToken,
      productionEnvToken: made.productionEnvToken,
      createdAt: made.createdAt.toISOString(),
      expiresAt: made.expiresAt.toISOString(),
    },
    { status: 201, headers: { "Cache-Control": "no-store" } }
  );
});

/** When the credentials were made and when they stop working. Never a token or a hash. */
export const GET = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id } = await params;
  const info = await buildCredentialInfoForUser(user.id, id);
  return NextResponse.json(
    {
      configured: info.length > 0,
      credentials: info.map((c) => ({
        scope: c.scope,
        createdAt: c.createdAt.toISOString(),
        expiresAt: c.expiresAt.toISOString(),
        expired: c.expired,
      })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
});

/** Remove the credentials. They stop working at once. */
export const DELETE = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id } = await params;
  await revokeBuildCredentialsForUser(user.id, id);
  return ok({ ok: true });
});
