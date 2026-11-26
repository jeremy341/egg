import { afterAll, beforeAll, expect, it } from "vitest";
import { boundedImportCopy } from "@/server/import-copy";
import { startMockSsh, type MockSsh } from "@/server/test/mock-ssh";
import { generateServerKey } from "@/server/ssh/keys";
import { NestSession, shellQuote } from "@/server/ssh/connection";

let mock: MockSsh;
let session: NestSession;
let base: string;
beforeAll(async () => {
  const key = generateServerKey("bounded-copy");
  mock = await startMockSsh({ authorizedKeys: [key.publicKey] });
  session = await NestSession.connect({ host: "127.0.0.1", port: mock.port, username: "test", privateKey: key.privateKey });
  base = `${mock.home}/project`;
  await session.script(`mkdir -p ${shellQuote(`${base}/releases/source`)}; printf 'hello' > ${shellQuote(`${base}/releases/source/index.html`)}; ln -s index.html ${shellQuote(`${base}/releases/source/link.html`)}`);
});
afterAll(async () => { session.close(); await mock.stop(); });
it("copies bounded regular data and preserves symlinks without following them", async () => {
  const result = await session.script(boundedImportCopy(`${base}/releases/source`, `${base}/releases/success`, base, 100, 0));
  expect(result.code).toBe(0);
  const check = await session.exec(`cat ${shellQuote(`${base}/releases/success/index.html`)}; readlink ${shellQuote(`${base}/releases/success/link.html`)}`);
  expect(check.stdout).toBe("helloindex.html\n");
});
it("stops a copy at its byte budget, including sparse files missed by allocated disk size", async () => {
  await session.script(`mkdir -p ${shellQuote(`${base}/releases/sparse`)}; truncate -s 1000000 ${shellQuote(`${base}/releases/sparse/large`)}`);
  const result = await session.script(boundedImportCopy(`${base}/releases/sparse`, `${base}/releases/denied`, base, 100, 0));
  expect(result.code).not.toBe(0);
  expect(result.stderr).toContain("copy byte budget");
  const size = await session.exec(`test ! -e ${shellQuote(`${base}/releases/denied/large`)} && echo untouched`);
  expect(size.stdout.trim()).toBe("untouched");
});
it("preserves the free-space floor before creating the destination", async () => {
  const result = await session.script(boundedImportCopy(`${base}/releases/source`, `${base}/releases/no-room`, base, 100, Number.MAX_SAFE_INTEGER));
  expect(result.code).not.toBe(0);
  expect(result.stderr).toContain("preserve free disk");
  const check = await session.exec(`test ! -e ${shellQuote(`${base}/releases/no-room`)} && echo untouched`);
  expect(check.stdout.trim()).toBe("untouched");
});
