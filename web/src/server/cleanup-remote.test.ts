import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupOwnedProject } from "@/server/deploy/remote";
import { NestSession, shellQuote } from "@/server/ssh/connection";
import { generateServerKey } from "@/server/ssh/keys";
import { startMockSsh, type MockSsh } from "@/server/test/mock-ssh";

let mock: MockSsh;
let session: NestSession;
beforeEach(async () => {
  const key = generateServerKey("cleanup-remote");
  mock = await startMockSsh({ authorizedKeys: [key.publicKey] });
  session = await NestSession.connect({ host: "127.0.0.1", port: mock.port, username: "test", privateKey: key.privateKey, pinnedHostKey: mock.hostKeyFingerprint });
  mock.addShim("systemctl", 'if [ "$1" = is-active ]; then exit 1; fi\nexit 0');
  mock.writeFile(`${mock.home}/.egg/app/releases/release/code.js`, "application code");
  mock.writeFile(`${mock.home}/.egg/app/shared/database.db`, "keep my data");
});
afterEach(async () => { session.close(); await mock.stop(); });
const cleanup = () => session.script(cleanupOwnedProject({ home: mock.home, slug: "app", units: ["egg-app.service"], unitDir: `${mock.home}/units` }));
const exists = async (file: string) => (await session.exec(`test -e ${shellQuote(file)}`)).code === 0;

describe("strict remote cleanup", () => {
  it("refuses an unmarked project without touching its files", async () => {
    mock.writeFile(`${mock.home}/units/egg-app.service`, "# egg:managed\n");
    expect((await cleanup()).code).toBe(44);
    expect(await exists(`${mock.home}/.egg/app/releases/release/code.js`)).toBe(true);
    expect(await exists(`${mock.home}/units/egg-app.service`)).toBe(true);
  });
  it("retains files and the unit when stopping the service fails", async () => {
    mock.writeFile(`${mock.home}/.egg/app/.egg-managed`, "");
    mock.writeFile(`${mock.home}/units/egg-app.service`, "# egg:managed\n");
    mock.addShim("systemctl", 'if [ "$1" = stop ]; then exit 1; fi\nexit 0');
    expect((await cleanup()).code).toBe(45);
    expect(await exists(`${mock.home}/.egg/app/releases/release/code.js`)).toBe(true);
    expect(await exists(`${mock.home}/units/egg-app.service`)).toBe(true);
  });
  it("removes verified deployed code and units while preserving shared application data", async () => {
    mock.writeFile(`${mock.home}/.egg/app/.egg-managed`, "");
    mock.writeFile(`${mock.home}/units/egg-app.service`, "# egg:managed\n");
    expect((await cleanup()).code).toBe(0);
    expect(await exists(`${mock.home}/.egg/app/releases/release/code.js`)).toBe(false);
    expect(await exists(`${mock.home}/units/egg-app.service`)).toBe(false);
    expect(await exists(`${mock.home}/.egg/app/shared/database.db`)).toBe(true);
  });
});
