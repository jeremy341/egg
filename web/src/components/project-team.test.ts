import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AcceptInvite } from "@/components/accept-invite";
import { ProjectTeam, type TeamInvitation, type TeamMember } from "@/components/project-team";
import { MAX_OPEN_INVITES } from "@/lib/team";

const DAY = 86_400_000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();

const member = (over: Partial<TeamMember> = {}): TeamMember => ({
  userId: "u1",
  role: "developer",
  createdAt: iso(-3),
  name: "Ada Lovelace",
  email: "ada@example.com",
  ...over,
});

const invitation = (over: Partial<TeamInvitation> = {}): TeamInvitation => ({
  id: "i1",
  email: "grace@example.com",
  invitedUserId: null,
  role: "viewer",
  createdAt: iso(-1),
  expiresAt: iso(6),
  acceptedAt: null,
  ...over,
});

function page(members: TeamMember[] = [], invitations: TeamInvitation[] = []): string {
  return renderToStaticMarkup(
    createElement(ProjectTeam, { projectId: "p1", projectName: "recipe-api", ownerName: "Sam", members, invitations })
  );
}

describe("the Team page", () => {
  it("names the project and the owner, and says nobody else has access when that is true", () => {
    const html = page();
    expect(html).toContain("Team");
    expect(html).toContain("recipe-api");
    expect(html).toContain("Sam (you)");
    expect(html).toContain("Nobody else has access yet.");
  });

  it("lists each member with a role control and a remove button named for them", () => {
    const html = page([member(), member({ userId: "u2", name: null, email: "lin@example.com", role: "viewer" })]);
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("ada@example.com");
    expect(html).toContain('aria-label="Role for Ada Lovelace"');
    expect(html).toContain('aria-label="Remove Ada Lovelace"');
    // A member with no name is shown by email, not as a blank.
    expect(html).toContain('aria-label="Role for lin@example.com"');
    expect(html).not.toContain("Nobody else has access yet.");
  });

  it("selects each member's current role", () => {
    const html = page([member({ role: "developer" })]);
    expect(html).toMatch(/<option value="developer" selected/);
  });

  it("shows only open invitations: not expired ones and not used ones", () => {
    const html = page([], [
      invitation({ id: "a", email: "open@example.com" }),
      invitation({ id: "b", email: "expired@example.com", expiresAt: iso(-1) }),
      invitation({ id: "c", email: "used@example.com", acceptedAt: iso(-2) }),
    ]);
    expect(html).toContain("open@example.com");
    expect(html).toContain("Expires in 6 days");
    expect(html).not.toContain("expired@example.com");
    expect(html).not.toContain("used@example.com");
    expect(html).toContain("Take back the invitation for open@example.com");
  });

  it("hides the open invitations section when there are none", () => {
    expect(page([], [invitation({ expiresAt: iso(-1) })])).not.toContain("Open invitations");
  });

  it("has a labelled email field and a role field that says what the role can do", () => {
    const html = page();
    expect(html).toMatch(/<label[^>]*>Email address<\/label>/);
    expect(html).toMatch(/<label[^>]*>Role<\/label>/);
    expect(html).toContain('type="email"');
    expect(html).toContain("Can read the project, its deployments, analytics and logs.");
  });

  it("explains all three roles and keeps servers and deletion with the owner", () => {
    const html = page();
    expect(html).toContain("What each role can do");
    for (const text of ["Viewer", "Developer", "Owner", "Servers, credentials and deleting the project stay with the owner"]) {
      expect(html).toContain(text);
    }
  });

  it("says Egg sends no email, so the owner knows to pass the link on", () => {
    expect(page()).toContain("Egg sends no email");
  });

  it("stops new invitations at the limit and says why", () => {
    const many = Array.from({ length: MAX_OPEN_INVITES }, (_, n) => invitation({ id: `i${n}`, email: `p${n}@example.com` }));
    const html = page([], many);
    expect(html).toContain(`${MAX_OPEN_INVITES} open invitations`);
    expect(html).toMatch(/<input[^>]*type="email"[^>]*disabled/);
  });

  it("does not render an invitation link before one has been created", () => {
    expect(page([], [invitation()])).not.toContain("/invite#token=");
  });
});

describe("the accept page", () => {
  it("offers one button and does not show a token or an error up front", () => {
    const html = renderToStaticMarkup(createElement(AcceptInvite));
    expect(html).toContain("Accept the invitation");
    expect(html).not.toContain("did not work");
    expect(html).not.toContain("token");
  });
});
