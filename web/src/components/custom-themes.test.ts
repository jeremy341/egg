import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CustomThemesSection } from "@/components/custom-themes";
import { CUSTOM_THEME_LIMIT, QUICK_DEFAULTS, deriveTokens, type CustomThemeView } from "@/lib/custom-theme";

const theme = (n: number, scheme: "light" | "dark" = "dark"): CustomThemeView => ({
  id: `abcdef0123456${String(n).padStart(3, "0")}`,
  preset: `custom:abcdef0123456${String(n).padStart(3, "0")}`,
  name: `Theme ${n}`,
  scheme,
  tokens: deriveTokens(QUICK_DEFAULTS[scheme], scheme),
  createdAt: 0,
  updatedAt: 0,
});

const render = (themes: CustomThemeView[]) =>
  renderToStaticMarkup(createElement(CustomThemesSection, { themes, onSaved: () => {}, onDeleted: () => {} }));

describe("the Your themes section", () => {
  it("lists each theme with a labelled Edit and Export button and says how many are used", () => {
    const html = render([theme(1), theme(2, "light")]);
    expect(html).toContain("Theme 1");
    expect(html).toContain('aria-label="Edit Theme 1"');
    expect(html).toContain('aria-label="Export Theme 2"');
    expect(html).toContain("2 of 20 used");
    expect(html).toMatch(/Dark/);
    expect(html).toMatch(/Light/);
  });

  it("offers New theme and Import theme, and a labelled file input that keyboard users do not need", () => {
    const html = render([]);
    expect(html).toContain("New theme");
    expect(html).toContain("Import theme");
    expect(html).toContain('aria-label="Theme file to import"');
    expect(html).toContain('accept="application/json,.json"');
    expect(html).toContain('tabindex="-1"');
    expect(html).not.toContain(' disabled=""');
    expect(html).toContain('role="status"');
  });

  it("offers Import a VS Code theme next to them, with its own labelled file input and the honest note", () => {
    const html = render([]);
    expect(html).toContain("Import a VS Code theme");
    expect(html).toContain('aria-label="VS Code theme file to import"');
    expect(html).toContain("Egg uses fewer colours than VS Code, so some parts of a VS Code theme will look different.");
    expect(html).toContain("Syntax colours are not used.");
    expect(html.indexOf("New theme")).toBeLessThan(html.indexOf("Import a VS Code theme"));
  });

  it("turns New theme and Import off at the limit, and says why", () => {
    const html = render(Array.from({ length: CUSTOM_THEME_LIMIT }, (_, i) => theme(i)));
    expect(html).toContain(`${CUSTOM_THEME_LIMIT} of ${CUSTOM_THEME_LIMIT} used`);
    expect(html).toContain("Delete one to add another");
    expect(html.match(/ disabled=""/g)?.length).toBe(3);
  });

  it("draws only valid colours into the page", () => {
    const bad = theme(1);
    bad.tokens = { ...bad.tokens, primary: "url(https://example.com/x.png)" };
    const html = render([bad]);
    expect(html).not.toContain("url(");
  });
});
