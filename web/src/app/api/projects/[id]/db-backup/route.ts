import { and, eq } from "drizzle-orm";
import { authed, handle, HttpError, ok } from "@/server/http";
import { open } from "@/server/crypto";
import { getDb, schema } from "@/server/db";
import { runDatabaseBackup } from "@/server/db-backup";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id } = await params;
  const db = await getDb();
  const project = await db.select({ id: schema.projects.id }).from(schema.projects)
    .where(and(eq(schema.projects.id, id), eq(schema.projects.userId, user.id))).get();
  if (!project) throw new HttpError(404, "Project not found", "not_found");
  const rows = await db.select().from(schema.envVars).where(eq(schema.envVars.projectId, id));
  const row = rows.find((candidate) => candidate.target === "production" && (candidate.key === "DATABASE_URL" || candidate.key === "POSTGRES_URL")) ??
    rows.find((candidate) => candidate.target === "all" && (candidate.key === "DATABASE_URL" || candidate.key === "POSTGRES_URL"));
  if (!row) throw new HttpError(400, "Add a production DATABASE_URL or POSTGRES_URL before creating a backup.", "database_missing");
  let databaseUrl: string;
  try { databaseUrl = open(row.valueEnc, `env:${id}:${row.key}:${row.target}`); }
  catch { throw new HttpError(400, "The database connection setting cannot be decrypted. Re-save it and try again.", "database_unavailable"); }
  const backup = await runDatabaseBackup({ projectId: id, databaseUrl });
  return ok({ backup }, 201);
});
