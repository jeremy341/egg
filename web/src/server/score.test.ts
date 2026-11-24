import { describe, expect, it } from "vitest";
import { parseScore, previewScore } from "./score";

describe("Score files", () => {
  it("parses supported resources and previews only the requested changes", () => {
    const score = parseScore(`ports:\n  - name: web\n    port: 3000\n    protocol: tcp\nvariables:\n  - name: NODE_ENV\n    value: production\ndatabases:\n  - name: main\n    type: postgres\n    version: "16"`);
    expect(score).toEqual({
      ports: [{ name: "web", port: 3000, protocol: "tcp" }],
      variables: [{ name: "NODE_ENV", value: "production" }],
      databases: [{ name: "main", type: "postgres", version: "16" }],
    });
    expect(previewScore(score)).toEqual({
      ports: score.ports,
      variables: [{ name: "NODE_ENV", action: "set" }],
      databases: score.databases,
    });
  });

  it.each([
    ["unknown root field", "services: []", /root field "services" is not supported/],
    ["unsafe port field", "ports:\n  - name: web\n    port: 3000\n    command: rm -rf /", /ports\[0\] field "command" is not supported/],
    ["unsafe database field", "databases:\n  - name: db\n    type: postgres\n    password: secret", /databases\[0\] field "password" is not supported/],
    ["YAML alias", "ports: &p []", /tags, aliases and merge keys are not allowed/],
    ["invalid port", "ports:\n  - name: web\n    port: 70000", /port must be an integer/],
  ])("rejects %s with a useful validation error", (_label, yaml, error) => {
    expect(() => parseScore(yaml)).toThrow(error);
  });
});
