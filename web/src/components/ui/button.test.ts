import { describe, expect, it } from "vitest";
import { buttonVariants } from "@/components/ui/button";

const VARIANTS = [
  "default",
  "brand",
  "outline",
  "secondary",
  "ghost",
  "destructive",
  "destructive-solid",
  "link",
] as const;

describe("buttonVariants disabled state", () => {
  it("never fades the whole button, so the label keeps its contrast", () => {
    for (const variant of VARIANTS) {
      expect(buttonVariants({ variant }), variant).not.toMatch(/disabled:(not-aria-busy:)?opacity-/);
    }
  });

  it("gives every variant an explicit readable disabled label colour", () => {
    for (const variant of VARIANTS) {
      expect(buttonVariants({ variant }), variant).toContain("disabled:not-aria-busy:text-muted-foreground");
    }
  });

  it("changes the surface of filled buttons so disabled is still obvious", () => {
    for (const variant of ["default", "brand", "secondary", "destructive", "destructive-solid"] as const) {
      expect(buttonVariants({ variant }), variant).toContain("disabled:not-aria-busy:bg-muted");
      expect(buttonVariants({ variant }), variant).toContain("disabled:not-aria-busy:border-border");
    }
  });
});
