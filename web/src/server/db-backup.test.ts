import { EventEmitter } from "node:events";
import { PassThrough, Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { buildPgDumpArgs, runDatabaseBackup, type BackupDependencies } from "@/server/db-backup";

const env: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  DB_BACKUP_S3_ENDPOINT: "https://storage.example.test",
  DB_BACKUP_S3_BUCKET: "backups",
  DB_BACKUP_S3_REGION: "auto",
  DB_BACKUP_S3_ACCESS_KEY_ID: "test-key",
  DB_BACKUP_S3_SECRET_ACCESS_KEY: "test-secret",
};

describe("database backups", () => {
  it("passes database URLs as a pg_dump argument, never through a shell", () => {
    const url = "postgres://user:p%40ss@db.example:5432/my-db?sslmode=require";
    expect(buildPgDumpArgs(url)).toEqual(["--format=custom", "--no-owner", "--no-acl"]);
  });

  it("pipes pg_dump to S3 and records metadata without storing the connection string", async () => {
    const uploaded: { key: string; body: string; contentType: string }[] = [];
    const deps: BackupDependencies = {
      now: () => new Date("2026-11-24T01:02:03Z"),
      spawn(command, args, options) {
        expect(command).toBe("pg_dump");
        expect(args).not.toContain("postgres://user:secret@db:5432/app");
        expect(options.env.PGPASSWORD).toBe("secret");
        expect(options.shell).toBe(false);
        const child = Object.assign(new EventEmitter(), {
          stdin: new PassThrough(), stdout: Readable.from([Buffer.from("dump-data")]), stderr: new PassThrough(), kill: vi.fn(),
        });
        setImmediate(() => child.emit("close", 0));
        return child as never;
      },
      async putObject(input) {
        const chunks: Buffer[] = [];
        for await (const chunk of input.body) chunks.push(Buffer.from(chunk));
        uploaded.push({ key: input.key, body: Buffer.concat(chunks).toString(), contentType: input.contentType });
      },
    };

    const result = await runDatabaseBackup({ projectId: "proj-1", databaseUrl: "postgres://user:secret@db:5432/app", env }, deps);

    expect(uploaded).toHaveLength(2);
    expect(uploaded[0]).toMatchObject({ body: "dump-data", contentType: "application/octet-stream" });
    expect(uploaded[1].contentType).toBe("application/json");
    expect(uploaded[1].body).not.toContain("secret");
    expect(JSON.parse(uploaded[1].body)).toMatchObject({ projectId: "proj-1", status: "completed", sizeBytes: 9 });
    expect(result).toMatchObject({ projectId: "proj-1", status: "completed", sizeBytes: 9 });
  });

  it("rejects non-Postgres URLs before spawning a process", async () => {
    const spawn = vi.fn();
    expect(() => runDatabaseBackup({ projectId: "p", databaseUrl: "mysql://db/app", env }, {
      now: () => new Date(), spawn: spawn as never, putObject: vi.fn(),
    })).toThrow(/PostgreSQL/);
    expect(spawn).not.toHaveBeenCalled();
  });
});
