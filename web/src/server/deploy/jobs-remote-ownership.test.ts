import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { UNIT_MARKER } from "@/server/deploy/layout";
import { installJob, jobServiceFile, jobTimerFile, jobUnits } from "@/server/deploy/jobs-remote";
import { parseSchedule } from "@/lib/cron-schedule";
import { NestSession, shellQuote } from "@/server/ssh/connection";
import { generateServerKey } from "@/server/ssh/keys";
import { startMockSsh, type MockSsh } from "@/server/test/mock-ssh";

// Unit names use only the first eight hex characters of a job id. These two
// jobs collide on a name, so the marker's full id must decide who owns a unit.

let mock: MockSsh;
let session: NestSession;
let unitDir: string;

beforeAll(async () => {
  const key = generateServerKey("jobs-remote-ownership-test");
  mock = await startMockSsh({ authorizedKeys: [key.publicKey] });
  session = await NestSession.connect({ host: "127.0.0.1", port: mock.port, username: "test", privateKey: key.privateKey });
  unitDir = `${mock.home}/units`;
  await session.exec(`mkdir -p ${shellQuote(unitDir)} ${shellQuote(`${mock.home}/.egg/foo/current`)}`);
  mock.addShim("systemctl", `if [ "$1" = is-active ]; then exit 1; fi\nexit 0`);
});

afterAll(async () => {
  session.close();
  await mock.stop();
});

const FIRST = "11111111-2222-3333-4444-555555555555";
const COLLIDING = "11111111-aaaa-bbbb-cccc-dddddddddddd";

const jobScript = (jobId: string) => installJob({
  home: mock.home,
  slug: "foo",
  jobId,
  unitDir,
  serviceFile: jobServiceFile({ slug: "foo", jobId, name: "Nightly", home: mock.home, command: "true" }),
  timerFile: jobTimerFile({ slug: "foo", jobId, name: "Nightly", schedule: parseSchedule("0 4 * * *") }),
  enabled: false,
});

const { service, timer } = jobUnits("foo", FIRST);
const marked = (jobId: string) => `${UNIT_MARKER} project=foo job=${jobId}\n[Unit]\nDescription=old\n`;

async function contents(unit: string) {
  return (await session.exec(`cat ${shellQuote(`${unitDir}/${unit}`)}`)).stdout;
}

afterEach(async () => {
  await session.exec(`rm -f ${shellQuote(`${unitDir}/${service}`)} ${shellQuote(`${unitDir}/${timer}`)}`);
});

describe("installJob job ownership", () => {
  it("refuses to overwrite both units marked for another job with the same short id", async () => {
    mock.writeFile(`${unitDir}/${service}`, marked(FIRST));
    mock.writeFile(`${unitDir}/${timer}`, marked(FIRST));
    const res = await session.script(jobScript(COLLIDING));
    expect(res.code).toBe(30);
    expect(res.stderr).toContain("was created for another job");
    expect(await contents(service)).toContain("Description=old");
    expect(await contents(timer)).toContain("Description=old");
  });

  it("checks the timer too when only the service carries another job's marker", async () => {
    mock.writeFile(`${unitDir}/${service}`, marked(FIRST));
    mock.writeFile(`${unitDir}/${timer}`, `${UNIT_MARKER} project=foo job=${COLLIDING}\n`);
    const res = await session.script(jobScript(FIRST));
    expect(res.code).toBe(30);
    expect(res.stderr).toContain("was created for another job");
    expect(await contents(service)).toContain("Description=old");
  });

  it("reinstalls over units that carry its own job marker", async () => {
    mock.writeFile(`${unitDir}/${service}`, marked(FIRST));
    mock.writeFile(`${unitDir}/${timer}`, marked(FIRST));
    expect((await session.script(jobScript(FIRST))).code).toBe(0);
    expect(await contents(service)).toContain(`job=${FIRST}`);
    expect(await contents(service)).not.toContain("Description=old");
    expect(await contents(timer)).toContain(`job=${FIRST}`);
  });
});
