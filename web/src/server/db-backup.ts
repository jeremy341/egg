import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { and, eq } from "drizzle-orm";
import { open } from "@/server/crypto";
import { getDb, schema } from "@/server/db";

export type BackupMetadata = {
  id: string;
  projectId: string;
  createdAt: string;
  status: "completed";
  objectKey: string;
  sizeBytes: number;
};

type Child = Pick<ChildProcessWithoutNullStreams, "stdin" | "stdout" | "stderr" | "kill" | "once">;
export type BackupDependencies = {
  now: () => Date;
  spawn: (command: string, args: string[], options: { env: NodeJS.ProcessEnv; shell: false; stdio: ["pipe", "pipe", "pipe"] }) => Child;
  putObject: (input: { key: string; body: Readable; contentType: string; env: NodeJS.ProcessEnv }) => Promise<void>;
};

const required = (env: NodeJS.ProcessEnv, key: string) => {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Missing required backup setting: ${key}`);
  return value;
};

function connectionEnv(databaseUrl: string): NodeJS.ProcessEnv {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("A valid PostgreSQL connection URL is required.");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") throw new Error("Only PostgreSQL databases can be backed up.");
  if (!url.hostname || !url.pathname.slice(1)) throw new Error("The PostgreSQL connection URL must include a host and database name.");
  return {
    NODE_ENV: process.env.NODE_ENV ?? "production",
    PATH: process.env.PATH,
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    ...(process.env.WINDIR ? { WINDIR: process.env.WINDIR } : {}),
    ...(process.env.LANG ? { LANG: process.env.LANG } : {}),
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    ...(url.searchParams.get("sslmode") ? { PGSSLMODE: url.searchParams.get("sslmode")! } : {}),
  };
}

/** No connection information is placed in argv, which is visible in process listings. */
export function buildPgDumpArgs(databaseUrl: string): string[] {
  // Validate the URL here so callers cannot bypass the supported protocol check.
  connectionEnv(databaseUrl);
  return ["--format=custom", "--no-owner", "--no-acl"];
}

function awsEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...process.env,
    AWS_ACCESS_KEY_ID: required(env, "DB_BACKUP_S3_ACCESS_KEY_ID"),
    AWS_SECRET_ACCESS_KEY: required(env, "DB_BACKUP_S3_SECRET_ACCESS_KEY"),
    AWS_DEFAULT_REGION: required(env, "DB_BACKUP_S3_REGION"),
    AWS_EC2_METADATA_DISABLED: "true",
  };
}

function defaultSpawn(command: string, args: string[], options: { env: NodeJS.ProcessEnv; shell: false; stdio: ["pipe", "pipe", "pipe"] }): Child {
  return nodeSpawn(command, args, { ...options, windowsHide: true }) as Child;
}

function defaultPutObject(input: { key: string; body: Readable; contentType: string; env: NodeJS.ProcessEnv }, spawn: BackupDependencies["spawn"]): Promise<void> {
  const endpoint = required(input.env, "DB_BACKUP_S3_ENDPOINT").replace(/\/$/, "");
  const bucket = required(input.env, "DB_BACKUP_S3_BUCKET");
  const region = required(input.env, "DB_BACKUP_S3_REGION");
  const destination = `s3://${bucket}/${input.key}`;
  const child = spawn("aws", ["s3", "cp", "-", destination, "--endpoint-url", endpoint, "--region", region, "--content-type", input.contentType, "--only-show-errors"], {
    env: awsEnv(input.env), shell: false, stdio: ["pipe", "pipe", "pipe"],
  });
  let errorText = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => { errorText = (errorText + chunk).slice(-4000); });
  const upload = pipeline(input.body, child.stdin);
  const exited = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`S3 upload failed${errorText ? `: ${errorText.trim()}` : "."}`)));
  });
  return Promise.all([upload, exited]).then(() => undefined);
}

const defaultDependencies: BackupDependencies = {
  now: () => new Date(),
  spawn: defaultSpawn,
  putObject(input) { return defaultPutObject(input, defaultDependencies.spawn); },
};

export function runDatabaseBackup(
  input: { projectId: string; databaseUrl: string; env?: NodeJS.ProcessEnv },
  deps: BackupDependencies = defaultDependencies
): Promise<BackupMetadata> {
  const env = input.env ?? process.env;
  const pgEnv = connectionEnv(input.databaseUrl);
  const timestamp = deps.now().toISOString().replace(/[:.]/g, "-");
  const id = `${timestamp}-${randomUUID()}`;
  const objectKey = `projects/${encodeURIComponent(input.projectId)}/${id}.dump`;
  const child = deps.spawn("pg_dump", buildPgDumpArgs(input.databaseUrl), {
    env: { ...pgEnv, ...pickBackupPgVariables(env, pgEnv) }, shell: false, stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end();
  const chunks: Buffer[] = [];
  child.stderr.on("data", (chunk: Buffer | string) => {
    if (Buffer.concat(chunks).length < 16_384) chunks.push(Buffer.from(chunk));
  });
  const stream = child.stdout as Readable;
  let sizeBytes = 0;
  stream.on("data", (chunk: Buffer) => { sizeBytes += chunk.length; });
  const dumpDone = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`pg_dump failed${chunks.length ? `: ${Buffer.concat(chunks).toString("utf8").trim()}` : "."}`)));
  });
  return (async () => {
    try {
      await deps.putObject({ key: objectKey, body: stream, contentType: "application/octet-stream", env });
      await dumpDone;
      const metadata: BackupMetadata = { id, projectId: input.projectId, createdAt: deps.now().toISOString(), status: "completed", objectKey, sizeBytes };
      await deps.putObject({ key: `${objectKey}.json`, body: Readable.from([JSON.stringify(metadata)]), contentType: "application/json", env });
      return metadata;
    } catch (error) {
      child.kill("SIGTERM");
      await dumpDone.catch(() => undefined);
      throw error;
    }
  })();
}

/** Scheduled worker entry point: backs up production/all DATABASE_URL or POSTGRES_URL variables. */
export async function runScheduledDatabaseBackups(env: NodeJS.ProcessEnv = process.env) {
  const db = await getDb();
  const projects = await db.select({ id: schema.projects.id }).from(schema.projects);
  const results: { projectId: string; status: "completed" | "skipped" | "failed"; error?: string }[] = [];
  for (const project of projects) {
    const rows = await db.select().from(schema.envVars).where(eq(schema.envVars.projectId, project.id));
    const row = rows.find((candidate) => candidate.target === "production" && (candidate.key === "DATABASE_URL" || candidate.key === "POSTGRES_URL")) ??
      rows.find((candidate) => candidate.target === "all" && (candidate.key === "DATABASE_URL" || candidate.key === "POSTGRES_URL"));
    if (!row) { results.push({ projectId: project.id, status: "skipped" }); continue; }
    try {
      const databaseUrl = open(row.valueEnc, `env:${project.id}:${row.key}:${row.target}`);
      if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) { results.push({ projectId: project.id, status: "skipped" }); continue; }
      await runDatabaseBackup({ projectId: project.id, databaseUrl, env });
      results.push({ projectId: project.id, status: "completed" });
    } catch (error) {
      results.push({ projectId: project.id, status: "failed", error: error instanceof Error ? error.message : "Backup failed." });
    }
  }
  return results;
}

function pickBackupPgVariables(env: NodeJS.ProcessEnv, parsed: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // Keep storage credentials out of pg_dump's environment while allowing standard PG tuning settings.
  const result: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV ?? "production" };
  for (const [key, value] of Object.entries(env)) if (key.startsWith("PG") && value !== undefined && !(key in parsed)) result[key] = value;
  return result;
}
