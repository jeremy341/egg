import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unpackSourceScript } from "@/server/deploy/container-build";
import { generateServerKey } from "@/server/ssh/keys";
import { NestSession } from "@/server/ssh/connection";
import { rawTarGz, sha256Of } from "@/server/test/raw-tar";
import { startMockSsh, type MockSsh } from "@/server/test/mock-ssh";

let mock: MockSsh;
let session: NestSession;
let temp: string;

beforeAll(async () => {
  const key = generateServerKey("extract-test");
  mock = await startMockSsh({ authorizedKeys: [key.publicKey] });
  session = await NestSession.connect({ host: "127.0.0.1", port: mock.port, username: "test", privateKey: key.privateKey });
  temp = mkdtempSync(path.join(tmpdir(), "egg-extract-test-"));
});
afterAll(async () => {
  session.close();
  await mock.stop();
  rmSync(temp, { recursive: true, force: true });
});

describe("unpacking a source archive", () => {
  it("stops a highly compressible archive before it can consume the disk reserve", async () => {
    const releaseId = "11111111-1111-4111-8111-111111111111";
    const archive = rawTarGz([{ name: "large.txt", content: Buffer.alloc(2 * 1024 * 1024, 65) }]);
    const local = path.join(temp, "source.tar.gz");
    writeFileSync(local, archive);
    await session.exec("mkdir -p \"$HOME/.egg/demo/incoming\" \"$HOME/.egg/demo/releases\"");
    await session.uploadFile(local, `${mock.home}/.egg/demo/incoming/${releaseId}.tar.gz`);
    // Simulate a filesystem just above the reserved free-space floor.
    mock.addShim("df", "#!/bin/sh\nprintf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\nfake 2097152 0 1048577 1%% /\\n'\n");
    const result = await session.script(unpackSourceScript({ home: mock.home, slug: "demo", releaseId, sha256: sha256Of(archive) }), { timeoutMs: 30_000 });
    expect(result.code).not.toBe(0);
    const size = await session.exec(`stat -c %s "$HOME/.egg/demo/releases/${releaseId}/large.txt" 2>/dev/null || printf 0`);
    expect(Number(size.stdout.trim())).toBeLessThan(2 * 1024 * 1024);
  }, 60_000);

  it("fails with an actionable error if the checksum tool is unavailable", async () => {
    const releaseId = "22222222-2222-4222-8222-222222222222";
    const archive = rawTarGz([{ name: "index.html", content: "hello" }]);
    const local = path.join(temp, "checksum.tar.gz");
    writeFileSync(local, archive);
    await session.exec("mkdir -p \"$HOME/.egg/demo/incoming\" \"$HOME/.egg/demo/releases\"");
    await session.uploadFile(local, `${mock.home}/.egg/demo/incoming/${releaseId}.tar.gz`);
    const hideChecksum = 'command() { if [ "$1" = "-v" ] && [ "${2:-}" = "sha256sum" ]; then return 1; fi; builtin command "$@"; }\n';
    const result = await session.script(hideChecksum + unpackSourceScript({ home: mock.home, slug: "demo", releaseId, sha256: sha256Of(archive) }), { timeoutMs: 30_000 });
    expect(result.code).toBe(21);
    expect(result.stderr).toContain("sha256sum is required");
  }, 60_000);
});
