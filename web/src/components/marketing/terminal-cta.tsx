import { Reveal } from "@/components/motion/reveal";

/**
 * A push, from the command to the release being live. It is sample output (the same made-up project
 * as the deployments list). One reveal for the whole terminal, so the lines are timed from the
 * moment it scrolls into view, like a command running. Each line dims to 15% while the terminal
 * is hidden and switches on after its own delay. When scripts or motion are off the terminal is
 * never hidden, so every line is simply at full opacity.
 *
 * The wrapper's own reveal styling (dim and rise) is cancelled: only the lines animate.
 */
const line =
  "block transition-opacity duration-150 ease-snappy group-data-[reveal=hidden]/term:opacity-15";

const LINES: { at: number; node: React.ReactNode }[] = [
  {
    at: 0,
    node: (
      <>
        <span className="text-subtle-foreground select-none">$ </span>git push origin main
      </>
    ),
  },
  { at: 450, node: <span className="text-muted-foreground">Cloning github.com/sam-r/hackatime-stats (branch main)</span> },
  { at: 800, node: <span className="text-muted-foreground">Commit 7c2f9ab: Fix timezone offset in weekly summary</span> },
  { at: 1150, node: <span className="text-muted-foreground">Packed release</span> },
  { at: 1500, node: <span className="text-muted-foreground">Switched to release 7c2f9ab and restarted</span> },
  {
    at: 1950,
    node: (
      <span className="flex items-center gap-2.5 font-medium">
        <span aria-hidden="true" className="size-2 shrink-0 bg-[var(--chick)]" />
        Live on your Nest
      </span>
    ),
  },
];

export function TerminalCta({ className }: { className?: string }) {
  return (
    <Reveal
      variant="light"
      className={`group/term min-w-0 bg-[var(--background-subtle)] shadow-[inset_0_0_0_1px_var(--rule)] data-[reveal=hidden]:opacity-100! ${className ?? ""}`}
    >
      <div className="flex h-[60px] items-center px-[var(--vg-inset)] font-mono text-[12px] text-muted-foreground shadow-[inset_0_-1px_0_var(--rule)]">
        ~/hackatime-stats
      </div>
      <pre className="px-[var(--vg-inset)] py-6 font-mono text-[13px] leading-[26px] whitespace-pre-wrap [overflow-wrap:anywhere] sm:text-[14px]">
        {LINES.map((l, i) => (
          <span key={i} className={line} style={{ transitionDelay: `${l.at}ms` }}>
            {l.node}
          </span>
        ))}
      </pre>
    </Reveal>
  );
}
