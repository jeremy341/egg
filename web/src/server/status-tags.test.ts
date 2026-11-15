import { describe, expect, it, vi } from "vitest";

describe("invalidateStatusPage", () => {
  it("does nothing for a project with no status page", async () => {
    const { invalidateStatusPage } = await import("@/server/status-tags");
    expect(await invalidateStatusPage(null)).toBe(false);
    expect(await invalidateStatusPage(undefined)).toBe(false);
  });

  it("does not throw when the Next cache is not available", async () => {
    vi.resetModules();
    vi.doMock("next/cache", () => ({
      revalidateTag: () => {
        throw new Error("Invariant: static generation store missing");
      },
    }));
    const { invalidateStatusPage } = await import("@/server/status-tags");
    await expect(invalidateStatusPage("abcdefgh1234")).resolves.toBe(false);
    vi.doUnmock("next/cache");
  });

  it("expires the tag for the page key when it is available", async () => {
    vi.resetModules();
    const revalidateTag = vi.fn();
    vi.doMock("next/cache", () => ({ revalidateTag }));
    const { invalidateStatusPage, statusTag } = await import("@/server/status-tags");
    await expect(invalidateStatusPage("abcdefgh1234")).resolves.toBe(true);
    expect(revalidateTag).toHaveBeenCalledWith(statusTag("abcdefgh1234"), { expire: 0 });
    vi.doUnmock("next/cache");
  });
});
