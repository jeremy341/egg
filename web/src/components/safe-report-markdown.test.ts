import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SafeReportMarkdown } from "./safe-report-markdown";

describe("private report Markdown", () => {
  it("renders useful formatting while escaping HTML and code", () => {
    const html = renderToStaticMarkup(
      createElement(SafeReportMarkdown, {
        source:
          "## Steps\n**Important**\n```html\n<script>alert(1)</script>\n```\n<img src=x onerror=alert(1)>",
      }),
    );
    expect(html).toContain("<strong>Important</strong>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
  });
  it("does not render active protocols or remote images", () => {
    const html = renderToStaticMarkup(
      createElement(SafeReportMarkdown, {
        source:
          "[attack](javascript:alert)\n![tracking](https://evil.test/pixel.png)\n[reference](https://example.test/report)",
      }),
    );
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain("<img");
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('href="https://example.test/report"');
  });
});
