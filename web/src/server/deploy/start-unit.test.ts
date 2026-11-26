import { describe, expect, it } from "vitest";
import { startUnit } from "@/server/deploy/remote";

describe("startUnit (stop/start checks)", () => {
  const unit = "egg-demo-abc12345.service";
  const script = startUnit(unit);

  it("only restarts the existing unit, without rebuilding or cloning", () => {
    expect(script).toContain(`systemctl restart '${unit}'`);
    // A restart must never redeploy: no source fetch, install, build, switch or image pull.
    expect(script).not.toMatch(/git clone|pnpm install|pnpm build|npm run build|docker (build|pull|compose)|switchToRelease/);
  });

  it("keeps the replica count: there is exactly one unit per project", () => {
    expect(script.match(/systemctl restart/g)).toHaveLength(1);
    expect(script).not.toMatch(/--now|enable|disable|instances|replicas/);
  });

  it("quotes the unit name so a crafted slug cannot inject commands", () => {
    const quoted = startUnit("egg-a; touch pwned.service");
    expect(quoted).toContain("systemctl restart 'egg-a; touch pwned.service'");
    // The echo line keeps the name inside double quotes too, so `;` stays inert.
    expect(quoted).toContain('echo "Started egg-a; touch pwned.service"');
    expect(quoted).not.toMatch(/^touch pwned/m);
  });
});
