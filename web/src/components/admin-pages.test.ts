import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Both components call the server only from event handlers; the render needs no network.
vi.mock("@/components/api", () => ({ api: vi.fn() }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => createElement("a", { href, ...rest }, children),
}));

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const maintenance = { enabled: false, active: false, message: "", startsAt: null, endsAt: null, updatedAt: null };

const overview = {
  users: 1234,
  projects: 56,
  servers: 7,
  maintenance,
  jobs: [
    { state: "queued", count: 2 },
    { state: "running", count: 1 },
  ],
  cleanup: [],
  reports: [{ state: "new", count: 3 }],
  events: [{ id: "e1", at: "2026-11-10T12:00:00.000Z" }],
};

describe("AdminDashboard", async () => {
  const { AdminDashboard } = await import("./admin-dashboard");
  const render = (o: typeof overview) => renderToStaticMarkup(createElement(AdminDashboard, { initial: o as never }));
  const html = render(overview);

  it("has one h1 and a heading for every card", () => {
    expect(html.match(/<h1/g)).toHaveLength(1);
    for (const title of ["Maintenance window", "Deployment queue", "Cleanup operations", "Vulnerability inbox", "Recent administration changes"]) {
      expect(html).toMatch(new RegExp(`<h2[^>]*>${title}</h2>`));
    }
  });

  it("shows the three totals as labelled figures", () => {
    expect(text(html)).toContain("Accounts 1,234");
    expect(text(html)).toContain("Projects 56");
    expect(text(html)).toContain("Servers 7");
  });

  it("lists each queue's counts by state, and says so when a queue has none", () => {
    expect(text(html)).toContain("queued 2");
    expect(text(html)).toContain("running 1");
    expect(text(html)).toContain("new 3");
    expect(text(html)).toContain("No records yet.");
  });

  it("labels every field of the maintenance form and links to the private inbox", () => {
    for (const id of ["maintenance-message", "maintenance-start", "maintenance-end"]) {
      expect(html).toContain(`for="${id}"`);
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('href="/security/reports"');
    expect(text(html)).toContain("Off");
  });

  it("says when the instance is read-only, in words and not by colour alone", () => {
    const active = render({ ...overview, maintenance: { ...maintenance, enabled: true, active: true } });
    expect(text(active)).toContain("Read-only now");
    expect(text(active)).toContain("End maintenance now");
  });

  it("draws every card in the app's frame", () => {
    expect(html).not.toMatch(/rounded-lg border bg-card/);
    expect(html.match(/shadow-border-small/g)!.length).toBeGreaterThanOrEqual(8);
  });
});

describe("SecurityReportInbox", async () => {
  const { SecurityReportInbox } = await import("./security-report-inbox");
  const rows = [
    { id: "r1", title: "Open redirect after sign-in", status: "new" as const, createdAt: "2026-11-09T10:00:00.000Z", anonymous: true, evidenceCount: 0 },
    { id: "r2", title: "Token shown twice", status: "resolved" as const, createdAt: "2026-11-08T10:00:00.000Z", anonymous: false, evidenceCount: 2 },
  ];

  it("lists each report as a button with its status in words", () => {
    const html = renderToStaticMarkup(createElement(SecurityReportInbox, { initial: rows }));
    expect(html.match(/<button type="button"/g)!.length).toBeGreaterThanOrEqual(2);
    expect(text(html)).toContain("Open redirect after sign-in");
    expect(text(html)).toContain("New");
    expect(text(html)).toContain("Resolved");
    expect(text(html)).toContain("Anonymous");
    expect(text(html)).toContain("Identity supplied");
    expect(html).toMatch(/<h2[^>]*>Reports<\/h2>/);
    expect(text(html)).toContain("Choose a report to read its private details.");
  });

  it("keeps the handling note, and says so when there is nothing to read", () => {
    const html = renderToStaticMarkup(createElement(SecurityReportInbox, { initial: [] }));
    expect(text(html)).toContain("Downloads are untrusted evidence");
    expect(text(html)).toContain("No reports yet.");
    expect(text(html)).toContain("The inbox is empty");
  });
});
