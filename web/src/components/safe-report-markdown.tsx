import { Fragment, type ReactNode } from "react";

/** A small Markdown subset rendered as React nodes. HTML and remote images stay text. */
function inline(text: string): ReactNode[] {
  const pattern =
    /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[[^\]\n]+\]\([^\s)]+\))/g;
  const nodes: ReactNode[] = [];
  let previous = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index! > previous) nodes.push(text.slice(previous, m.index));
    const token = m[0];
    const key = `${m.index}`;
    if (token.startsWith("`"))
      nodes.push(
        <code
          key={key}
          className="rounded bg-background-subtle px-1 font-mono text-[0.9em]"
        >
          {token.slice(1, -1)}
        </code>,
      );
    else if (token.startsWith("**"))
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("*"))
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)!;
      let safe = false;
      try {
        safe = ["https:", "http:"].includes(new URL(link[2]).protocol);
      } catch {
        /* show unsafe links as text */
      }
      nodes.push(
        safe ? (
          <a
            key={key}
            className="link underline"
            href={link[2]}
            rel="noopener noreferrer"
            target="_blank"
          >
            {link[1]}
          </a>
        ) : (
          token
        ),
      );
    }
    previous = m.index! + token.length;
  }
  nodes.push(text.slice(previous));
  return nodes;
}

export function SafeReportMarkdown({ source }: { source: string }) {
  const lines = source.slice(0, 30_000).replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let code: string[] | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("```")) {
      if (code) {
        out.push(
          <pre
            key={i}
            className="overflow-x-auto rounded-md border bg-background-subtle p-3 text-sm"
          >
            <code>{code.join("\n")}</code>
          </pre>,
        );
        code = null;
      } else code = [];
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }
    if (!line.trim()) continue;
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      out.push(
        <p
          key={i}
          className={
            heading[1].length === 1
              ? "text-xl font-semibold"
              : "text-base font-semibold"
          }
        >
          {inline(heading[2])}
        </p>,
      );
      continue;
    }
    const item = /^(?:[-*]|\d+\.)\s+(.+)$/.exec(line);
    out.push(
      item ? (
        <p key={i} className="pl-4">
          • {inline(item[1])}
        </p>
      ) : (
        <p key={i} className="whitespace-pre-wrap">
          {inline(line)}
        </p>
      ),
    );
  }
  if (code)
    out.push(
      <pre
        key="unclosed"
        className="overflow-x-auto rounded-md border bg-background-subtle p-3 text-sm"
      >
        <code>{code.join("\n")}</code>
      </pre>,
    );
  return (
    <div className="space-y-3 break-words text-sm leading-6 [overflow-wrap:anywhere]">
      {out.map((node, i) => (
        <Fragment key={i}>{node}</Fragment>
      ))}
    </div>
  );
}
