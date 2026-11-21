import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EnvValueFields } from "@/components/env-import";

describe("EnvValueFields", () => {
  it("shows a detected name and where the example file came from", () => {
    const html = renderToStaticMarkup(createElement(EnvValueFields, {
      env: [{ name: "API_KEY", source: ".env.example", hasExampleValue: false }],
      values: {},
      onChange() {},
    }));
    expect(html).toContain("API_KEY");
    expect(html).toContain("from .env.example");
  });

  it("shows a detected bot token with its suggestion label", () => {
    const html = renderToStaticMarkup(createElement(EnvValueFields, {
      env: [{ name: "DISCORD_TOKEN", source: "Discord bot (discord.js)", hasExampleValue: false, suggested: true }],
      values: {},
      onChange() {},
    }));
    expect(html).toContain("DISCORD_TOKEN");
    expect(html).toContain("suggested for Discord bot (discord.js)");
  });

  it("gives every row its own input id", () => {
    const html = renderToStaticMarkup(createElement(EnvValueFields, {
      env: [
        { name: "API_KEY", source: ".env.example", hasExampleValue: false },
        { name: "DISCORD_TOKEN", source: "Discord bot (discord.js)", hasExampleValue: false, suggested: true },
      ],
      values: {},
      onChange() {},
    }));
    expect(html).toContain('id="np-env-API_KEY"');
    expect(html).toContain('id="np-env-DISCORD_TOKEN"');
  });
});
