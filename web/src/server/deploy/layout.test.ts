import { describe, expect, it } from "vitest";
import {
  scopedSlug,
  serverDiscriminator,
  slugify,
  unitName,
} from "./layout";
import { dockerComposeProjectName, dockerContainerName, dockerImageTag } from "./remote";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("server-scoped host names", () => {
  it("derives a stable, distinct eight-hex discriminator from the server id", () => {
    expect(serverDiscriminator(A)).toMatch(/^[0-9a-f]{8}$/);
    expect(serverDiscriminator(A)).toBe(serverDiscriminator(A));
    expect(serverDiscriminator(A)).not.toBe(serverDiscriminator(B));
    expect(() => serverDiscriminator("")).toThrow();
  });

  it("gives two accounts with the same slug disjoint unit, container, image and Compose names", () => {
    const a = serverDiscriminator(A);
    const b = serverDiscriminator(B);
    const slug = "api";
    expect(unitName(slug, undefined, a)).toBe(`egg-api-${a}.service`);
    expect(unitName(slug, undefined, b)).toBe(`egg-api-${b}.service`);
    expect(unitName(slug, { releaseId: "0a1b2c3d-0000-0000-0000-000000000000" }, a)).toBe(`egg-api-${a}-pv-0a1b2c3d.service`);

    expect(dockerContainerName(slug, undefined, a)).toBe(`egg-api-${a}`);
    expect(dockerContainerName(slug, undefined, b)).toBe(`egg-api-${b}`);
    expect(dockerImageTag(slug, "0a1b2c3d-0000-0000-0000-000000000000", false, a)).toBe(`egg-api-${a}:0a1b2c3d`);
    expect(dockerComposeProjectName(slug, a)).toBe(`egg-api-${a}`);
    expect(dockerComposeProjectName(slug, b)).toBe(`egg-api-${b}`);
  });

  it("keeps the longest readable name inside systemd and Docker limits", () => {
    const slug = slugify("x".repeat(100));
    const scope = serverDiscriminator(A);
    const names = [
      unitName(slug, { releaseId: "0a1b2c3d-0000-0000-0000-000000000000" }, scope),
      dockerContainerName(slug, { releaseId: "0a1b2c3d-0000-0000-0000-000000000000" }, scope),
      dockerComposeProjectName(slug, scope),
    ];
    // systemd unit names allow 255 bytes and Docker container names 255 chars;
    // even a 40-char slug plus a scope and a preview suffix stays far below that.
    for (const name of names) expect(name.length).toBeLessThanOrEqual(100);
  });

  it("carries the scope in the ownership marker and in the folder name helper", () => {
    const scope = serverDiscriminator(A);
    expect(scopedSlug("api", scope)).toBe(`api-${scope}`);
    expect(scopedSlug("api")).toBe("api");
  });
});
