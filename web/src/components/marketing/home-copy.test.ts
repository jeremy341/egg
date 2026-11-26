import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * House rules for the homepage text: the page, its layout and the header,
 * footer and menu components. Checked on the source, so a rule cannot slip
 * back in with a later edit.
 */
const FILES = [
  "src/app/(marketing)/page.tsx",
  "src/app/(marketing)/layout.tsx",
  "src/components/marketing/site-header.tsx",
  "src/components/marketing/marketing-nav.tsx",
  "src/components/marketing/mobile-menu.tsx",
  "src/components/marketing/footer-switch.tsx",
];
const read = (file: string) => readFileSync(path.resolve(__dirname, "../../..", file), "utf8");
const page = read("src/app/(marketing)/page.tsx");
const layout = read("src/app/(marketing)/layout.tsx");

const BANNED = [
  "powerful",
  "seamless",
  "effortless",
  "unlock",
  "supercharge",
  "journey",
  "elevate",
  "built for",
  "revolutionize",
  "streamline",
];

describe("homepage copy", () => {
  it.each(FILES)("%s has no em or en dashes", (file) => {
    expect(read(file)).not.toMatch(/[–—]|&[mn]dash;/);
  });

  it.each(FILES)("%s uses none of the banned words", (file) => {
    const text = read(file).toLowerCase();
    for (const word of BANNED) expect(text, word).not.toContain(word);
  });

  it("does not link to the docs, which need sign-in", () => {
    for (const src of [page, layout]) {
      expect(src).not.toMatch(/href=["{`][^"}`]*\/docs/);
      expect(src.toLowerCase()).not.toContain("read the docs");
    }
  });

  it("makes sign-in the primary action", () => {
    expect(page).toContain('<Link href="/login" className={cn(primary, "h-12 px-7 text-[15px]")}>');
    expect(layout).toMatch(/href="\/login"[\s\S]{0,200}bg-foreground text-background/);
  });

  it("presents Egg as an add-on that connects to Nest, never part of it", () => {
    expect(page).toContain("Egg connects to the Hack Club Nest container you already have");
    expect(page).not.toMatch(/Egg is part of Nest|part of Hack Club Nest/);
    expect(page).not.toContain("Nest Deploy");
  });
});
