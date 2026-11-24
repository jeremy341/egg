import type { SVGProps } from "react";
import { cn } from "@/lib/utils";

/**
 * The agent marks from Orchard's docs, verbatim: same path data, stroke widths,
 * colours and CSS variable. They are inline drawings, not the companies' brand
 * assets. Only JSX attribute casing differs from the source strings.
 *
 * Decorative by design: the button's own aria-label carries the meaning, so
 * every mark is hidden from assistive tech.
 */
export const AGENT_MARKS = [
  { name: "claude", label: "Claude" },
  { name: "cursor", label: "Cursor" },
  { name: "codex", label: "Codex" },
  { name: "vscode", label: "VS Code" },
  { name: "opencode", label: "OpenCode" },
  { name: "github", label: "GitHub" },
] as const;

export type AgentMarkName = (typeof AGENT_MARKS)[number]["name"];

/** The four marks Orchard's live CopyPromptButton actually renders, in order. */
export const ORCHARD_BUTTON_MARKS = ["claude", "codex", "cursor", "opencode"] as const satisfies readonly AgentMarkName[];

export function AgentMark({
  name,
  className,
  ...props
}: { name: AgentMarkName } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={cn("size-3", className)} {...props}>
      {name === "claude" ? (
        <g stroke="#d97757" strokeWidth="2.200" strokeLinecap="round" fill="none">
          <path d="M12 2.500v19" />
          <path d="M2.500 12h19" />
          <path d="m5.300 5.300 13.400 13.400" />
          <path d="m18.700 5.300-13.400 13.400" />
          <path d="m7.300 3.700 9.400 16.600" />
          <path d="m16.700 3.700-9.400 16.600" />
          <path d="m3.700 7.300 16.600 9.400" />
          <path d="m20.300 7.300-16.600 9.400" />
        </g>
      ) : null}
      {name === "cursor" ? (
        <>
          <path fill="currentColor" d="M12 1.500 21 6.700v10.600L12 22.500 3 17.300V6.700Z" />
          <path fill="var(--o-mark-ink)" d="M12 12 4.800 7.800 12 3.600l7.200 4.200Z" opacity=".55" />
          <path fill="var(--o-mark-ink)" d="M12 12v8.400l7.200-4.200V7.800Z" opacity=".25" />
        </>
      ) : null}
      {name === "codex" ? (
        <>
          <circle cx="12" cy="12" r="10.500" fill="currentColor" />
          <g
            fill="none"
            stroke="var(--o-mark-ink)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m7 9 3.500 3L7 15" />
            <path d="M12.500 15.500H17" />
          </g>
        </>
      ) : null}
      {name === "vscode" ? (
        <path
          fill="#2f9fe0"
          d="M17.200 1.800 7.700 10.700 3.700 7.600 1.800 8.600 5.700 12l-3.900 3.400 1.900 1 4-3.100 9.500 8.900 5-2.400V4.200Zm0 5.300v9.800L10.800 12Z"
        />
      ) : null}
      {name === "opencode" ? (
        <>
          <path fill="currentColor" fillRule="evenodd" d="M4 2.500h16v19H4Zm4 4v11h8v-11Z" />
          <rect x="10" y="10" width="4" height="4.500" fill="currentColor" />
        </>
      ) : null}
      {name === "github" ? (
        <path
          fill="currentColor"
          d="M12 .3a12 12 0 0 0-3.800 23.400c.6.100.8-.3.800-.6v-2c-3.300.7-4-1.600-4-1.600-.6-1.400-1.400-1.800-1.400-1.800-1-.7.100-.7.100-.7 1.200 0 1.900 1.200 1.900 1.200 1 1.800 2.800 1.300 3.500 1 0-.8.400-1.300.7-1.600-2.700-.3-5.500-1.300-5.500-6 0-1.200.5-2.300 1.300-3.100-.2-.4-.6-1.600 0-3.200 0 0 1-.3 3.400 1.200a11.500 11.500 0 0 1 6 0c2.300-1.500 3.300-1.200 3.300-1.200.6 1.600.2 2.800 0 3.200.9.800 1.300 1.900 1.300 3.200 0 4.600-2.800 5.600-5.500 5.900.5.400.9 1 .9 2.200v3.300c0 .3.100.7.800.6A12 12 0 0 0 12 .3"
        />
      ) : null}
    </svg>
  );
}

/**
 * The row of marks on Orchard's Copy buttons: four 20px drawings, 3px apart,
 * in Claude / Codex / Cursor / OpenCode order. Matches their live docs button
 * exactly; VS Code and GitHub are still available from AGENT_MARKS if needed.
 */
export function AgentMarks({
  marks = ORCHARD_BUTTON_MARKS,
  className,
}: {
  marks?: readonly AgentMarkName[];
  className?: string;
}) {
  return (
    <span aria-hidden="true" className={cn("inline-flex shrink-0 items-center gap-[0.1875rem]", className)}>
      {marks.map((name) => (
        <AgentMark key={name} name={name} className="size-5" />
      ))}
    </span>
  );
}
