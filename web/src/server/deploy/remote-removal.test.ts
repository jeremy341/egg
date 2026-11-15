import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { removeOwnUnit } from "@/server/deploy/remote";
import { SH_MARKER_HELPERS, UNIT_MARKER } from "@/server/deploy/layout";
import { NestSession } from "@/server/ssh/connection";
import { generateServerKey } from "@/server/ssh/keys";
import { startMockSsh, type MockSsh } from "@/server/test/mock-ssh";

let mock: MockSsh;
let session: NestSession;
const unit = "egg-demo.service";
let unitDir: string;
let unitPath: string;

beforeAll(async () => {
  const key = generateServerKey("remote-removal-test");
  mock = await startMockSsh({ authorizedKeys: [key.publicKey] });
  session = await NestSession.connect({ host: "127.0.0.1", port: mock.port, username: "test", privateKey: key.privateKey });
  unitDir = `${mock.home}/units`;
  unitPath = `${unitDir}/${unit}`;
  await session.exec(`mkdir -p ${unitDir}`);
});

afterAll(async () => {
  session.close();
  await mock.stop();
});

async function runRemoval(options: { owned?: boolean; failure?: "stop" | "active" | "disable" | "reload" } = {}) {
  if (options.owned !== false) mock.writeFile(unitPath, `${UNIT_MARKER} project=demo\n`);
  else await session.exec(`rm -f ${unitPath}`);
  const script =
    `FAIL_MODE=${options.failure ?? ""}\n` +
    `systemctl() { case "$1" in stop) [ "$FAIL_MODE" != stop ];; is-active) [ "$FAIL_MODE" = active ];; disable) [ "$FAIL_MODE" != disable ];; daemon-reload) [ "$FAIL_MODE" != reload ];; esac; }\n` +
    SH_MARKER_HELPERS +
    removeOwnUnit(unitDir, unit);
  return session.script(script);
}

describe("removeOwnUnit", () => {
  it("returns failure and preserves the unit when systemd cannot stop it", async () => {
    const result = await runRemoval({ failure: "stop" });

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Could not stop egg-demo.service");
    expect((await session.exec(`cat ${unitPath}`)).stdout).toContain(UNIT_MARKER);
  });

  it("returns failure and preserves the unit if it remains active after stop", async () => {
    const result = await runRemoval({ failure: "active" });

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("still active");
    expect((await session.exec(`cat ${unitPath}`)).stdout).toContain(UNIT_MARKER);
  });

  it("returns failure and preserves the unit when systemd cannot disable it", async () => {
    const result = await runRemoval({ failure: "disable" });

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Could not disable egg-demo.service");
    expect((await session.exec(`cat ${unitPath}`)).stdout).toContain(UNIT_MARKER);
  });

  it("leaves unmarked units untouched and reports an ownership failure", async () => {
    mock.writeFile(unitPath, "[Service]\nExecStart=/bin/true\n");
    const result = await session.script(SH_MARKER_HELPERS + removeOwnUnit(unitDir, unit));

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("was not created by Egg");
    expect((await session.exec(`cat ${unitPath}`)).stdout).toContain("ExecStart=/bin/true");
  });

  it("succeeds when the unit is already absent", async () => {
    const result = await runRemoval({ owned: false });

    expect(result.code).toBe(0);
  });

  it("returns failure if systemd cannot reload after removing the unit", async () => {
    const result = await runRemoval({ failure: "reload" });

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Could not reload systemd");
    expect((await session.exec(`[ -e ${unitPath} ] && echo present || echo absent`)).stdout.trim()).toBe("absent");
  });
});
