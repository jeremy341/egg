import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ENV_TARGET_LABEL, EnvHelp } from "@/components/env-help";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("EnvHelp", () => {
  const copy = text(renderToStaticMarkup(createElement(EnvHelp)));

  it("says which environment each value applies to", () => {
    expect(copy).toContain("Both means production and preview");
  });

  it("says saving needs a deploy before the running app changes", () => {
    expect(copy).toContain("Saving does not change the running app. Deploy again");
  });

  it("says a rollback restores the release's own values", () => {
    expect(copy).toContain("Rolling back restores the values that release was deployed with");
  });

  it("uses plain punctuation, without dashes", () => {
    expect(copy).not.toMatch(/[–—]/);
  });
});

describe("ENV_TARGET_LABEL", () => {
  it("labels each stored scope in the words the form uses", () => {
    expect(ENV_TARGET_LABEL).toEqual({ all: "Both", production: "Production", preview: "Preview" });
  });
});
