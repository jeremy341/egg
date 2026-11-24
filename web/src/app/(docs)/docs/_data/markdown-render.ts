import { createElement, Fragment } from "react";
import { createRequire } from "node:module";
import { CONTENT } from "../_content";
import { DOCS_SECTIONS, getSection, type DocsSection } from "./nav";

// Next bans react-dom/server in the static module graph of route handlers.
// Load it at runtime through require; this module is only used by server routes.
const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");

/**
 * Every docs page as Markdown, made from the same content the pages render.
 *
 * A page's body is React, so it is first rendered to HTML on the server and
 * then that HTML is read back into a small tree and written out as Markdown.
 * The reader handles only the tags the docs use (headings, paragraphs, lists,
 * links, code, tables, quotes); anything it does not know is read through, so
 * its text is kept. Controls (buttons, icons, the SVG marks) and text that is
 * only for screen readers' decoration are left out.
 */

type Text = { text: string };
type El = { tag: string; attrs: Record<string, string>; children: Node[] };
type Node = Text | El;

const VOID = new Set(["br", "hr", "img", "input", "meta", "link", "col", "source", "wbr"]);
const BLOCK = new Set([
  "address", "article", "aside", "blockquote", "dd", "details", "dialog", "div", "dl", "dt", "figcaption",
  "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p",
  "pre", "section", "summary", "table", "ul",
]);
const SKIP = new Set(["button", "input", "textarea", "select", "script", "style", "svg", "img"]);

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isNaN(code) ? m : String.fromCodePoint(code);
    }
    return ENTITIES[e] ?? m;
  });
}

/** Reads the HTML that React renders into a tree of elements and text. */
export function parseHtml(html: string): Node[] {
  const root: El = { tag: "#root", attrs: {}, children: [] };
  const stack: El[] = [root];
  const token = /<!--[\s\S]*?-->|<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>|<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>\/=]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = token.exec(html))) {
    const [whole, closeTag, openTag, attrText, , textRun] = m;
    if (whole.startsWith("<!--")) continue;
    if (textRun !== undefined) {
      stack[stack.length - 1].children.push({ text: decode(textRun) });
    } else if (closeTag) {
      const tag = closeTag.toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
    } else if (openTag) {
      const tag = openTag.toLowerCase();
      const attrs: Record<string, string> = {};
      for (const a of attrText.matchAll(/([^\s"'>\/=]+)(?:="([^"]*)")?/g)) attrs[a[1]] = decode(a[2] ?? "");
      const el: El = { tag, attrs, children: [] };
      stack[stack.length - 1].children.push(el);
      const selfClosing = m[4] === "/";
      if (!selfClosing && !VOID.has(tag)) stack.push(el);
    }
  }
  return root.children;
}

const isText = (n: Node): n is Text => "text" in n;
const classes = (el: El) => (el.attrs.class ?? "").split(/\s+/);

/** Text inside a node, with no whitespace changes. */
function plain(nodes: Node[]): string {
  return nodes.map((n) => (isText(n) ? n.text : plain(n.children))).join("");
}

/** Controls, icons, and the screen-reader-only notes that only a sighted page needs. */
function hidden(el: El): boolean {
  if (SKIP.has(el.tag)) return true;
  if (el.attrs["aria-hidden"] === "true" || el.attrs["aria-live"] !== undefined) return true;
  return classes(el).includes("sr-only") && /opens in a new tab/.test(plain(el.children));
}

const collapse = (s: string) => s.replace(/\s+/g, " ");

function inline(nodes: Node[]): string {
  return nodes.map(inlineNode).join("");
}

function wrap(mark: string, inner: string): string {
  const t = inner.trim();
  return t === "" ? "" : `${mark}${t}${mark}`;
}

function codeSpan(text: string): string {
  if (text === "") return "";
  const fence = text.includes("`") ? "``" : "`";
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

function inlineNode(n: Node): string {
  if (isText(n)) return collapse(n.text);
  if (hidden(n)) return "";
  switch (n.tag) {
    case "code":
      return codeSpan(plain(n.children));
    case "strong":
    case "b":
      return wrap("**", inline(n.children));
    case "em":
    case "i":
      return wrap("*", inline(n.children));
    case "br":
      return "\n";
    case "a": {
      const label = inline(n.children).trim();
      const href = n.attrs.href;
      if (!label) return "";
      return href ? `[${label}](${href})` : label;
    }
    default:
      return BLOCK.has(n.tag) ? ` ${inline(n.children)} ` : inline(n.children);
  }
}

/** Block-level content: runs of inline text become paragraphs, block elements their own blocks. */
function blocks(nodes: Node[]): string[] {
  const out: string[] = [];
  let run: Node[] = [];
  const flush = () => {
    const t = inline(run).replace(/[ \t]+/g, " ").trim();
    if (t) out.push(t);
    run = [];
  };
  for (const n of nodes) {
    if (isText(n) || !BLOCK.has(n.tag)) {
      run.push(n);
      continue;
    }
    flush();
    if (!hidden(n)) out.push(...renderBlock(n));
  }
  flush();
  return out;
}

/** Continuation lines of a list item sit under its text; blank lines stay blank. */
function hang(text: string, marker: string): string {
  const pad = " ".repeat(marker.length);
  return text
    .split("\n")
    .map((line, i) => (i === 0 ? marker + line : line === "" ? "" : pad + line))
    .join("\n");
}

function table(el: El): string {
  const rows: El[] = [];
  const collect = (nodes: Node[]) => {
    for (const n of nodes) {
      if (isText(n)) continue;
      if (n.tag === "tr") rows.push(n);
      else collect(n.children);
    }
  };
  collect(el.children);
  const cells = rows.map((r) =>
    r.children
      .filter((c): c is El => !isText(c) && (c.tag === "th" || c.tag === "td"))
      .map((c) => inline(c.children).replace(/\s+/g, " ").trim().replace(/\|/g, "\\|"))
  );
  if (cells.length === 0) return "";
  const width = Math.max(...cells.map((r) => r.length));
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`;
  const [head, ...body] = cells;
  return [line(head), `| ${Array(width).fill("---").join(" | ")} |`, ...body.map(line)].join("\n");
}

function renderBlock(el: El): string[] {
  const { tag } = el;
  if (/^h[1-6]$/.test(tag)) {
    const level = Number(tag[1]);
    const title = inline(el.children).replace(/\s+/g, " ").trim();
    return title ? [`${"#".repeat(level)} ${title}`] : [];
  }
  switch (tag) {
    case "ul":
    case "ol": {
      const items = el.children.filter((c): c is El => !isText(c) && c.tag === "li");
      return items.length === 0
        ? []
        : [items.map((li, i) => hang(blocks(li.children).join("\n\n"), tag === "ol" ? `${i + 1}. ` : "- ")).join("\n")];
    }
    case "pre": {
      const text = plain(el.children).replace(/\n+$/, "");
      const fence = text.includes("```") ? "~~~~" : "```";
      return [`${fence}\n${text}\n${fence}`];
    }
    case "table": {
      const t = table(el);
      return t ? [t] : [];
    }
    case "blockquote":
      return blocks(el.children).map((b) => b.split("\n").map((l) => (l === "" ? ">" : `> ${l}`)).join("\n"));
    case "hr":
      return ["---"];
    default:
      return blocks(el.children);
  }
}

/** One rendered page body as Markdown (no trailing newline). */
export function htmlToMarkdown(html: string): string {
  return blocks(parseHtml(html))
    .join("\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sectionMarkdown(section: DocsSection): string | null {
  const render = CONTENT[section.id];
  if (!render) return null;
  const html = renderToStaticMarkup(createElement(Fragment, null, render()));
  return `${htmlToMarkdown(html)}\n`;
}

/** The Markdown of one docs page, or null for an unknown page. */
export function pageMarkdown(slug: string): string | null {
  const section = getSection(slug);
  return section ? sectionMarkdown(section) : null;
}

export function llmsFullTxt(): string {
  const pages = DOCS_SECTIONS.map(sectionMarkdown).filter((md): md is string => md !== null);
  return `# Egg docs\n\n${pages.join("\n\n---\n\n")}\n`;
}
