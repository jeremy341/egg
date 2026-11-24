import { describe, expect, it } from "vitest";
import { llmsTxt } from "../../docs/_data/markdown";
import { DOCS_NAV, DOCS_SECTIONS, docsHref, groupOf } from "../../docs/_data/nav";
import { GET } from "./route";

const origin = "https://docs.example.test";
const get = (section: string) =>
  GET(new Request(`${origin}/llms/${section}`), { params: Promise.resolve({ section }) });
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const linkLines = (body: string) => body.split("\n").filter((line) => line.startsWith("- ["));

const mainIndex = llmsTxt(origin);

describe("/llms/[section]", () => {
  it("serves one section as plain text, headed '# Egg: <section>'", async () => {
    const res = await get("start");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const body = await res.text();
    expect(body.startsWith("# Egg: Start\n\n")).toBe(true);
    expect(body).toContain(`- [How it works](${origin}${docsHref("overview")}.md): `);
    expect(linkLines(body).length).toBeGreaterThan(0);
  });

  it("lists exactly that section's pages, with the lines the main index uses", async () => {
    const seen: string[] = [];
    for (const group of DOCS_NAV) {
      const body = await (await get(slug(group.group))).text();
      expect(body.startsWith(`# Egg: ${group.group}\n\n`), group.group).toBe(true);
      expect(body.endsWith("\n"), group.group).toBe(true);

      const lines = linkLines(body);
      expect(lines, group.group).toHaveLength(group.sections.length);
      for (const line of lines) expect(mainIndex, line).toContain(line);
      for (const section of group.sections) {
        expect(body, section.id).toContain(`- [${section.title}](${origin}${docsHref(section.id)}.md): `);
        seen.push(section.id);
      }
      const other = DOCS_SECTIONS.find((s) => groupOf(s.id) !== group.group)!;
      expect(body, group.group).not.toContain(`${docsHref(other.id)}.md`);
    }
    expect(seen.sort()).toEqual(DOCS_SECTIONS.map((s) => s.id).sort());
  });

  it("accepts a section's displayed name as well as its URL form", async () => {
    const body = await (await get("Use it")).text();
    expect(body.startsWith("# Egg: Use it\n\n")).toBe(true);
    expect(body).toContain(`${docsHref("servers")}.md`);
  });

  it("answers 404 for a section that does not exist", async () => {
    const res = await get("nope");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(DOCS_NAV.some((g) => slug(g.group) === "nope")).toBe(false);
  });
});
