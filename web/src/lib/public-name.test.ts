import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, publicName, PUBLIC_FALLBACK_NAME } from "@/lib/preferences";

describe("publicName", () => {
  it("is on by default", () => {
    expect(DEFAULT_PREFERENCES.showNamePublic).toBe(true);
  });

  it("shows the display name while the switch is on", () => {
    expect(publicName({ displayName: "Sam", showNamePublic: true })).toBe("Sam");
  });

  it("trims the display name", () => {
    expect(publicName({ displayName: "  Sam  ", showNamePublic: true })).toBe("Sam");
  });

  it("says Someone when the switch is off, whatever the display name is", () => {
    expect(publicName({ displayName: "Sam", showNamePublic: false })).toBe("Someone");
    expect(publicName({ displayName: null, showNamePublic: false })).toBe("Someone");
  });

  it("says Someone when there is no display name, rather than a fallback name", () => {
    expect(publicName({ displayName: null, showNamePublic: true })).toBe(PUBLIC_FALLBACK_NAME);
    expect(publicName({ displayName: "   ", showNamePublic: true })).toBe("Someone");
  });

  it("uses the word Someone", () => {
    expect(PUBLIC_FALLBACK_NAME).toBe("Someone");
  });
});
