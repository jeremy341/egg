import { describe, expect, it } from "vitest";
import { authorizedBuildToken } from "@/server/builds/authorization";

const token = (scope: string) => `egg_build_${scope}_${"A".repeat(43)}`;

describe("GitHub build credentials are read only from a scoped Authorization header", () => {
  it("accepts the requested bearer scope case-insensitively", () => {
    expect(authorizedBuildToken(new Headers({ authorization: `bEaReR ${token("upload")}` }), "upload")).toBe(token("upload"));
    expect(authorizedBuildToken(new Headers({ authorization: `Bearer ${token("env_preview")}` }), "env_preview")).toBe(token("env_preview"));
  });

  it("refuses missing, URL-only, wrong-scope, malformed, or ambiguous credentials", () => {
    expect(authorizedBuildToken(new Headers(), "upload")).toBeNull();
    expect(authorizedBuildToken(new Headers(), "env_preview")).toBeNull();
    expect(authorizedBuildToken(new Headers({ authorization: token("upload") }), "upload")).toBeNull();
    expect(authorizedBuildToken(new Headers({ authorization: `Bearer ${token("env_preview")}` }), "upload")).toBeNull();
    expect(authorizedBuildToken(new Headers({ authorization: `Bearer ${token("upload")} trailing` }), "upload")).toBeNull();
    expect(authorizedBuildToken(new Headers({ authorization: `Bearer egg_build_upload_short` }), "upload")).toBeNull();
    expect(authorizedBuildToken(new Headers({ authorization: `Bearer ${token("upload")}, Bearer ${token("upload")}` }), "upload")).toBeNull();
  });
});
