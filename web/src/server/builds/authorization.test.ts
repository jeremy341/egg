import { describe, expect, it } from "vitest";
import { authorizedBuildToken } from "@/server/builds/authorization";

const token = (scope: string) => `egg_build_${scope}_${"A".repeat(43)}`;

describe("GitHub build credentials are read only from a scoped Authorization header", () => {
  it("accepts the requested bearer scope case-insensitively", () => {
    expect(authorizedBuildToken(new Headers({ authorization: `bEaReR ${token("upload_preview")}` }), "upload_preview")).toBe(token("upload_preview"));
    expect(authorizedBuildToken(new Headers({ authorization: `Bearer ${token("env_preview")}` }), "env_preview")).toBe(token("env_preview"));
  });

  it("keeps the two upload scopes apart: a preview upload credential is not a production one", () => {
    expect(authorizedBuildToken(new Headers({ authorization: `Bearer ${token("upload_production")}` }), "upload_production")).toBe(token("upload_production"));
    expect(authorizedBuildToken(new Headers({ authorization: `Bearer ${token("upload_preview")}` }), "upload_production")).toBeNull();
    expect(authorizedBuildToken(new Headers({ authorization: `Bearer ${token("upload_production")}` }), "upload_preview")).toBeNull();
    expect(authorizedBuildToken(new Headers({ authorization: `Bearer ${token("env_production")}` }), "upload_production")).toBeNull();
  });

  it("refuses missing, URL-only, wrong-scope, malformed, or ambiguous credentials", () => {
    expect(authorizedBuildToken(new Headers(), "upload_preview")).toBeNull();
    expect(authorizedBuildToken(new Headers(), "env_preview")).toBeNull();
    expect(authorizedBuildToken(new Headers({ authorization: token("upload_preview") }), "upload_preview")).toBeNull();
    expect(authorizedBuildToken(new Headers({ authorization: `Bearer ${token("env_preview")}` }), "upload_preview")).toBeNull();
    expect(authorizedBuildToken(new Headers({ authorization: `Bearer ${token("upload_preview")} trailing` }), "upload_preview")).toBeNull();
    expect(authorizedBuildToken(new Headers({ authorization: `Bearer egg_build_upload_preview_short` }), "upload_preview")).toBeNull();
    expect(authorizedBuildToken(new Headers({ authorization: `Bearer ${token("upload_preview")}, Bearer ${token("upload_preview")}` }), "upload_preview")).toBeNull();
  });
});
