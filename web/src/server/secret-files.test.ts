import { describe, expect, it } from "vitest";
import { isSecretFile, SECRET_FILE_CODE } from "@/server/secret-files";

describe("isSecretFile", () => {
  it("names the live release's and every release's top-level .env", () => {
    expect(isSecretFile("current/.env")).toBe(true);
    expect(isSecretFile("releases/abc123/.env")).toBe(true);
    expect(isSecretFile("env/11111111-1111-4111-8111-111111111111.env")).toBe(true);
    expect(isSecretFile("current.env")).toBe(true);
  });

  it("names only Egg's temporary build-environment files as secrets", () => {
    expect(isSecretFile("incoming/11111111-1111-4111-8111-111111111111.buildenv")).toBe(true);
    expect(isSecretFile("incoming/11111111-1111-4111-8111-111111111111.tar.gz")).toBe(false);
    expect(isSecretFile("incoming/notes.txt")).toBe(false);
  });

  it("leaves other files alone, including a .env the owner keeps in shared/", () => {
    expect(isSecretFile("shared/.env")).toBe(false);
    expect(isSecretFile("current/.env.example")).toBe(false);
    expect(isSecretFile("current/app/.env")).toBe(false);
    expect(isSecretFile("current")).toBe(false);
    expect(isSecretFile("")).toBe(false);
  });

  it("does not treat a bad path as secret; the file service rejects it itself", () => {
    expect(isSecretFile("current/../.env")).toBe(false);
  });

  it("uses the code the API already returns", () => {
    expect(SECRET_FILE_CODE).toBe("secret_file");
  });
});
