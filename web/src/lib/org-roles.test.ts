import { describe, expect, it } from "vitest";
import { assignableRoles, canChangeRoles, canInvite, canRemoveMember } from "@/lib/org-roles";

describe("organization control visibility", () => {
  it("only owners change roles and can hand out the owner role", () => {
    expect(canChangeRoles("owner")).toBe(true);
    expect(canChangeRoles("admin")).toBe(false);
    expect(assignableRoles("owner")).toContain("owner");
    expect(assignableRoles("admin")).not.toContain("owner");
    expect(assignableRoles("member")).toEqual([]);
  });

  it("owners remove anyone else; admins remove members and guests only", () => {
    expect(canRemoveMember("owner", "admin", false)).toBe(true);
    expect(canRemoveMember("owner", "owner", false)).toBe(true);
    expect(canRemoveMember("admin", "member", false)).toBe(true);
    expect(canRemoveMember("admin", "guest", false)).toBe(true);
    expect(canRemoveMember("admin", "admin", false)).toBe(false);
    expect(canRemoveMember("admin", "owner", false)).toBe(false);
  });

  it("nobody removes themselves from the members list (leave is separate), and members remove nobody", () => {
    expect(canRemoveMember("owner", "owner", true)).toBe(false);
    expect(canRemoveMember("admin", "admin", true)).toBe(false);
    expect(canRemoveMember("member", "guest", false)).toBe(false);
  });

  it("admins and owners can invite; members and guests cannot", () => {
    expect(canInvite("owner")).toBe(true);
    expect(canInvite("admin")).toBe(true);
    expect(canInvite("member")).toBe(false);
    expect(canInvite("guest")).toBe(false);
  });
});
