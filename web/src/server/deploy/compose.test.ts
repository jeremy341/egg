import { describe, expect, it } from "vitest";
import {
  composeMainImage,
  composeMainVolumes,
  unsafeComposeYaml,
  validateResolvedCompose,
} from "./docker-target";

const project = "egg-api-1a2b3c4d";
const opts = { service: "web", containerPort: 3000, project };
const resolved = (overrides: Record<string, unknown> = {}) => ({
  name: project,
  services: {
    web: {
      image: "registry.example.com/team/api:1.2.3",
      ports: [],
      volumes: [{ type: "volume", source: "data", target: "/data" }],
      ...overrides,
    },
    db: {
      image: "postgres:16",
      volumes: [{ type: "volume", source: "data", target: "/var/lib/postgresql/data" }],
    },
  },
  volumes: { data: { name: `${project}_data`, driver: "local" } },
  networks: { default: { name: `${project}_default`, driver: "bridge" } },
});

describe("Compose deployment isolation", () => {
  it("validates the same resolved form it runs and derives the main image from it", () => {
    const spec = resolved();
    expect(validateResolvedCompose(spec, opts).errors).toEqual([]);
    expect(composeMainImage(spec, "web")).toBe("registry.example.com/team/api:1.2.3");
    expect(composeMainVolumes(spec, "web", project)).toEqual([`${project}_data:/data`]);
  });

  it("forbids fields that can escape the project's own namespace", () => {
    for (const [field, value] of Object.entries({
      container_name: "victim",
      depends_on: ["db"],
      links: ["db"],
      privileged: true,
      cap_add: ["SYS_ADMIN"],
      devices: ["/dev/sda"],
      network_mode: "host",
      security_opt: ["label=disable"],
      volumes_from: ["db"],
    })) {
      const spec = resolved({ [field]: value });
      const errors = validateResolvedCompose(spec, opts).errors;
      expect(errors.some((e) => e.includes(field)), field).toBe(true);
    }
  });

  it("refuses external networks and volumes, and bind mounts", () => {
    const externalVolume = resolved();
    (externalVolume.volumes as Record<string, unknown>).outside = { external: true };
    expect(validateResolvedCompose(externalVolume, opts).errors.join(" ")).toMatch(/Invalid volume/);

    const bind = resolved();
    (bind.services as Record<string, unknown>).web = {
      image: "api:latest",
      volumes: [{ type: "bind", source: "/etc", target: "/etc" }],
    };
    expect(validateResolvedCompose(bind, opts).errors.join(" ")).toMatch(/named volumes/);
  });

  it("refuses parser-level escape hatches in the canonical YAML", () => {
    expect(unsafeComposeYaml("web:\n  image: api:latest\n")).toBeNull();
    expect(unsafeComposeYaml("web:\n  image: !include other.yml\n")).toMatch(/YAML tags/);
    expect(unsafeComposeYaml("x-common: &base\n  image: api\nweb:\n  <<: *base\n")).toMatch(/anchors/);
  });
});
