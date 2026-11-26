import { describe, expect, it } from "vitest";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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

describe("buttonVariants touch target and shape", () => {
  it("grows the hit area on coarse pointers for every variant and size", () => {
    for (const variant of VARIANTS) {
      for (const size of ["default", "xs", "sm", "lg", "icon", "icon-xs", "icon-sm", "icon-lg"] as const) {
        expect(buttonVariants({ variant, size }), `${variant} ${size}`).toContain("touch-target");
      }
    }
  });

  it("is a rounded rectangle by default and a capsule on request", () => {
    expect(cn(buttonVariants({}))).toContain("rounded-md");
    expect(cn(buttonVariants({}))).not.toContain("rounded-full");
    for (const size of ["default", "xs", "sm", "lg"] as const) {
      const capsule = cn(buttonVariants({ size, shape: "capsule" }));
      expect(capsule, size).toContain("rounded-full");
      expect(capsule.split(" "), size).not.toContain("rounded-md");
      expect(capsule, size).not.toContain("rounded-[");
    }
  });
});
