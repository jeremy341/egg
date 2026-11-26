import { cn } from "@/lib/utils";
import type { UiState } from "@/lib/status";
import { PixelLoader } from "@/components/ui/pixel-loader";

const META: Record<
  UiState | "none",
  { label: string; dot: string; pending?: string }
> = {
  ready: { label: "Ready", dot: "bg-ready" },
  building: {
    label: "Building",
    dot: "",
    pending: "text-[var(--status-building)]",
  },
  error: { label: "Error", dot: "bg-[var(--status-error)]" },
  queued: { label: "Queued", dot: "", pending: "text-subtle-foreground" },
  canceled: { label: "Canceled", dot: "bg-subtle-foreground" },
  none: { label: "Not deployed", dot: "bg-[var(--ds-gray-500)]" },
};

/** The 8px mark: a round dot, or the pixel scanner while work is in progress. */
function Mark({ dot, pending }: { dot: string; pending?: string }) {
  if (pending) {
    return (
      <span
        aria-hidden="true"
        className={cn("inline-flex size-2 shrink-0 items-center justify-center", pending)}
      >
        <PixelLoader size="sm" />
      </span>
    );
  }
  return (
    // data-mark: the dashboard draws this as a lit square (components/dashboard.css).
    <span data-mark="" aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", dot)} />
  );
}

/**
 * A deployment state mark.
 *
 * The rule: every status mark in a card or a list carries its word. A quiet
 * "Ready" is still a word, so a green square on its own never stands in for
 * the state. `iconOnly` is for the one case where an adjacent heading already
 * says what the mark means (a card titled "Status", a column header). It keeps
 * the word for screen readers and shows it as a tooltip.
 *
 * `showLabel` is the old name for the same switch (`showLabel={false}` is
 * `iconOnly`). Prefer `iconOnly`.
 */
export function StatusDot({
  state,
  iconOnly = false,
  showLabel = true,
  className,
}: {
  state: UiState | null;
  iconOnly?: boolean;
  /** @deprecated Use `iconOnly`. */
  showLabel?: boolean;
  className?: string;
}) {
  const meta = META[state ?? "none"];
  const visible = showLabel && !iconOnly;
  return (
    <span
      title={visible ? undefined : meta.label}
      className={cn(
        "inline-flex items-center gap-2 font-medium tracking-[-0.02em]",
        className
      )}
    >
      <Mark dot={meta.dot} pending={meta.pending} />
      {visible ? (
        <span>{meta.label}</span>
      ) : (
        <span className="sr-only">{meta.label}</span>
      )}
    </span>
  );
}

type Tone = "ready" | "building" | "error" | "warning" | "neutral";

const TONES: Record<Tone, { dot: string; pending: string }> = {
  ready: { dot: "bg-ready", pending: "text-ready" },
  building: {
    dot: "bg-[var(--status-building)]",
    pending: "text-[var(--status-building)]",
  },
  error: {
    dot: "bg-[var(--status-error)]",
    pending: "text-[var(--status-error)]",
  },
  warning: {
    dot: "bg-[var(--ds-amber-700)]",
    pending: "text-[var(--ds-amber-700)]",
  },
  neutral: { dot: "bg-subtle-foreground", pending: "text-subtle-foreground" },
};

/**
 * A status mark with a caller-supplied label, for states that are not
 * deployment states (service health, alerts, domains). Same layout as
 * StatusDot, and the label is required: there is no icon-only form. `pending` swaps the dot for the pixel scanner.
 */
export function StatusIndicator({
  tone,
  label,
  pending = false,
  className,
}: {
  tone: Tone;
  label: React.ReactNode;
  pending?: boolean;
  className?: string;
}) {
  const t = TONES[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 font-medium tracking-[-0.01em]",
        className
      )}
    >
      <Mark dot={t.dot} pending={pending ? t.pending : undefined} />
      <span>{label}</span>
    </span>
  );
}
