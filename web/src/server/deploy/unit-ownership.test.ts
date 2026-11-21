import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SH_MARKER_HELPERS, UNIT_MARKER } from "@/server/deploy/layout";
import { cleanupOwnedProject, guardUnitFree, removeOwnUnit, removePreview, removeProject } from "@/server/deploy/remote";
import { installJob, jobTimerFile, jobServiceFile, jobUnits, removeJob, removeUnits, runJobNow } from "@/server/deploy/jobs-remote";
import { parseSchedule } from "@/lib/cron-schedule";
import { NestSession, shellQuote } from "@/server/ssh/connection";
import { generateServerKey } from "@/server/ssh/keys";
import { startMockSsh, type MockSsh } from "@/server/test/mock-ssh";

// Unit names overlap: a-pv-12345678 is both a slug and the preview unit of
// the project a, and a-pv-1234 is also that project's name in its marker.
// These tests pin down that only the project its marker names may change it.

let mock: MockSsh;
let session: NestSession;
let unitDir: string;

beforeAll(async () => {
  const key = generateServerKey("unit-ownership-test");
  mock = await startMockSsh({ authorizedKeys: [key.publicKey] });
  session = await NestSession.connect({ host: "127.0.0.1", port: mock.port, username: "test", privateKey: key.privateKey });
  unitDir = `${mock.home}/units`;
  await session.exec(`mkdir -p ${shellQuote(unitDir)}`);
  mock.addShim("systemctl", `if [ "$1" = is-active ]; then exit 1; fi\nexit 0`);
});

afterAll(async () => {
  session.close();
  await mock.stop();
});

const RELEASE = "12345678-1234-1234-1234-123456789012";
const JOB = "11111111-2222-3333-4444-555555555555";

/** An Egg unit file marked for `project`, or untagged when project is null. */
function writeUnit(name: string, project: string | null) {
  mock.writeFile(`${unitDir}/${name}`, project === null
    ? `${UNIT_MARKER}\n[Unit]\nDescription=old\n`
    : `${UNIT_MARKER} project=${project}\n[Unit]\nDescription=old\n`);
}

async function present(name: string) {
  return (await session.exec(`test -e ${shellQuote(`${unitDir}/${name}`)}`)).code === 0;
}

/** A systemctl that is always down, so the removal paths can complete. */
const systemctlDown = `systemctl() { case "$1" in is-active) return 1;; esac; return 0; }\n`;

describe("guardUnitFree", () => {
  const unit = "egg-foo-pv-12345678.service";

  it("refuses a unit Egg wrote for another project", async () => {
    writeUnit(unit, "foo");
    const res = await session.script(guardUnitFree(unitDir, unit, "foo-pv-12345678"));
    expect(res.code).toBe(30);
    expect(res.stderr).toContain("was created by Egg for another project");
    expect(await present(unit)).toBe(true);
  });

  it("allows the project its marker names", async () => {
    writeUnit(unit, "foo");
    expect((await session.script(guardUnitFree(unitDir, unit, "foo"))).code).toBe(0);
  });

  it("keeps a unit written before the marker grew a project", async () => {
    writeUnit(unit, null);
    expect((await session.script(guardUnitFree(unitDir, unit, "foo-pv-12345678"))).code).toBe(0);
  });

  it("still refuses a unit it did not write", async () => {
    mock.writeFile(`${unitDir}/${unit}`, "[Service]\nExecStart=/bin/true\n");
    const res = await session.script(guardUnitFree(unitDir, unit, "foo-pv-12345678"));
    expect(res.code).toBe(30);
    expect(res.stderr).toContain("was not created by Egg");
  });

  it("with no project, checks only the marker, the shape outside one project uses", async () => {
    writeUnit(unit, "foo");
    expect((await session.script(guardUnitFree(unitDir, unit))).code).toBe(0);
  });
});

describe("removeOwnUnit", () => {
  const unit = "egg-foo.service";

  it("leaves another project's unit alone", async () => {
    writeUnit(unit, "bar");
    const res = await session.script(systemctlDown + SH_MARKER_HELPERS + removeOwnUnit(unitDir, unit, "foo"));
    expect(res.code).toBe(30);
    expect(res.stderr).toContain("was created by Egg for another project");
    expect(await present(unit)).toBe(true);
  });

  it("removes the unit of the project asked for", async () => {
    writeUnit(unit, "foo");
    const res = await session.script(systemctlDown + SH_MARKER_HELPERS + removeOwnUnit(unitDir, unit, "foo"));
    expect(res.code).toBe(0);
    expect(await present(unit)).toBe(false);
  });

  it("still removes a unit written before the marker grew a project", async () => {
    writeUnit(unit, null);
    const res = await session.script(systemctlDown + SH_MARKER_HELPERS + removeOwnUnit(unitDir, unit, "foo"));
    expect(res.code).toBe(0);
    expect(await present(unit)).toBe(false);
  });

  it("still refuses a unit it did not write", async () => {
    mock.writeFile(`${unitDir}/${unit}`, "[Service]\nExecStart=/bin/true\n");
    const res = await session.script(systemctlDown + SH_MARKER_HELPERS + removeOwnUnit(unitDir, unit, "foo"));
    expect(res.code).toBe(30);
    expect(res.stderr).toContain("was not created by Egg");
    expect(await present(unit)).toBe(true);
  });
});

describe("removePreview", () => {
  const unit = "egg-foo-pv-12345678.service";

  it("must not remove the production unit of the project whose slug collides with a preview's name", async () => {
    writeUnit(unit, "foo-pv-12345678");
    const res = await session.script(removePreview({ home: mock.home, slug: "foo", releaseId: RELEASE, unit, unitDir }));
    expect(res.code).toBe(30);
    expect(await present(unit)).toBe(true);
  });

  it("removes its own preview unit and leaves a colliding folder's unit alone", async () => {
    writeUnit(unit, "foo");
    expect((await session.script(systemctlDown + removePreview({ home: mock.home, slug: "foo", releaseId: RELEASE, unit, unitDir }))).code).toBe(0);
    expect(await present(unit)).toBe(false);
  });
});

describe("removeProject", () => {
  const unit = "egg-foo.service";

  it("leaves a unit at its name that belongs to another project", async () => {
    writeUnit(unit, "bar");
    const res = await session.script(systemctlDown + removeProject({ home: mock.home, slug: "foo", unit, unitDir, deleteData: false }));
    expect(res.code).toBe(30);
    expect(await present(unit)).toBe(true);
  });

  it("removes the unit of the project asked for", async () => {
    writeUnit(unit, "foo");
    expect((await session.script(systemctlDown + removeProject({ home: mock.home, slug: "foo", unit, unitDir, deleteData: false }))).code).toBe(0);
    expect(await present(unit)).toBe(false);
  });
});

describe("cleanupOwnedProject", () => {
  const unit = "egg-app.service";
  const touchFolder = () => mock.writeFile(`${mock.home}/.egg/app/.egg-managed`, "");

  it("refuses a unit that belongs to another project", async () => {
    touchFolder();
    writeUnit(unit, "other");
    const res = await session.script(cleanupOwnedProject({ home: mock.home, slug: "app", units: [unit], unitDir }));
    expect(res.code).toBe(44);
    expect(await present(unit)).toBe(true);
    expect((await session.exec(`test -e ${shellQuote(`${mock.home}/.egg/app/.egg-managed`)}`)).code).toBe(0);
  });

  it("cleans up a unit written before the marker grew a project", async () => {
    touchFolder();
    writeUnit(unit, null);
    expect((await session.script(cleanupOwnedProject({ home: mock.home, slug: "app", units: [unit], unitDir }))).code).toBe(0);
    expect(await present(unit)).toBe(false);
  });
});

describe("installJob", () => {
  const { service, timer } = jobUnits("foo", JOB);
  const jobScript = (slug: string) => installJob({
    home: mock.home,
    slug,
    jobId: JOB,
    unitDir,
    serviceFile: jobServiceFile({ slug, jobId: JOB, name: "Nightly", home: mock.home, command: "true" }),
    timerFile: jobTimerFile({ slug, jobId: JOB, name: "Nightly", schedule: parseSchedule("0 4 * * *") }),
    enabled: false,
  });

  it("must not replace a production unit whose slug collides with a job unit name", async () => {
    await session.exec(`mkdir -p ${shellQuote(`${mock.home}/.egg/foo/current`)}`);
    const colliding = jobUnits("foo", JOB).service; // egg-foo-job-11111111.service
    writeUnit(colliding, "foo-job-11111111");
    const res = await session.script(jobScript("foo"));
    expect(res.code).toBe(30);
    expect(res.stderr).toContain("was created by Egg for another project");
    expect(await present(colliding)).toBe(true);
    await session.exec(`rm -rf ${shellQuote(`${mock.home}/.egg/foo`)}`);
  });

  it("installs over its own earlier unit", async () => {
    await session.exec(`mkdir -p ${shellQuote(`${mock.home}/.egg/foo/current`)}`);
    writeUnit(service, "foo");
    expect((await session.script(jobScript("foo"))).code).toBe(0);
    expect((await session.exec(`cat ${shellQuote(`${unitDir}/${service}`)}`)).stdout).toContain("egg:managed");
    await session.exec(`rm -f ${shellQuote(`${unitDir}/${service}`)} ${shellQuote(`${unitDir}/${timer}`)}; rm -rf ${shellQuote(`${mock.home}/.egg/foo`)}`);
  });
});

describe("removeJob and removeUnits", () => {
  const { service, timer } = jobUnits("foo", JOB);

  it("leaves another project's job units alone", async () => {
    writeUnit(timer, "bar");
    writeUnit(service, "bar");
    const res = await session.script(systemctlDown + removeJob({ slug: "foo", jobId: JOB, unitDir }));
    expect(res.code).toBe(30);
    expect(await present(service)).toBe(true);
    expect(await present(timer)).toBe(true);
  });

  it("removes its own job units", async () => {
    writeUnit(timer, "foo");
    writeUnit(service, "foo");
    expect((await session.script(systemctlDown + removeJob({ slug: "foo", jobId: JOB, unitDir }))).code).toBe(0);
    expect(await present(service)).toBe(false);
    expect(await present(timer)).toBe(false);
  });

  it("removeUnits refuses another project's unit when told the project", async () => {
    writeUnit(service, "bar");
    expect((await session.script(systemctlDown + removeUnits(unitDir, [service], "foo"))).code).toBe(30);
    expect(await present(service)).toBe(true);
    writeUnit(service, "foo");
    expect((await session.script(systemctlDown + removeUnits(unitDir, [service], "foo"))).code).toBe(0);
    expect(await present(service)).toBe(false);
  });
});

describe("runJobNow", () => {
  const { service } = jobUnits("foo", JOB);

  it("refuses to start another project's job unit", async () => {
    writeUnit(service, "bar");
    const res = await session.script(runJobNow({ slug: "foo", jobId: JOB, unitDir }));
    expect(res.code).toBe(32);
    expect(res.stderr).toContain("is not installed");
    expect(await present(service)).toBe(true);
  });

  it("starts its own job unit", async () => {
    writeUnit(service, "foo");
    expect((await session.script(runJobNow({ slug: "foo", jobId: JOB, unitDir }))).code).toBe(0);
  });
});
