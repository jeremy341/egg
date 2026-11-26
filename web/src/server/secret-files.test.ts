import { describe, expect, it } from "vitest";
import { isSecretFile, SECRET_FILE_CODE } from "@/server/secret-files";

describe("isSecretFile", () => {
  it("names the live release's and every release's top-level .env", () => {
    expect(isSecretFile("current/.env")).toBe(true);
    expect(isSecretFile("releases/abc123/.env")).toBe(true);
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
