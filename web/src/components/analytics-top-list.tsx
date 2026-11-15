const number = new Intl.NumberFormat("en");

/**
 * A ranked list with a bar behind each row. The bar is decoration; the number
 * and its unit are the data. Used for top pages, referrers and top clicks.
 */
export function TopList({
  title,
  rows,
  empty,
  unit = "views",
}: {
  title: string;
  rows: { label: string; views: number }[];
  empty: string;
  /** Said after the number for screen readers, such as "views" or "clicks". */
  unit?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.views));
  return (
    <section className="overflow-hidden rounded-lg bg-card shadow-border-small">
      <h2 className="border-b px-4 py-3 text-title-3">{title}</h2>
      {rows.length === 0 ? (
        <p className="px-4 py-5 text-muted-foreground">{empty}</p>
      ) : (
        <ul className="hairline-y">
          {rows.map((r) => (
            <li
              key={r.label}
              className="relative flex items-center justify-between gap-4 px-4 py-2.5 transition-colors duration-(--dur-fast) hover:bg-[var(--ds-gray-alpha-100)]"
            >
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 bg-[var(--ds-gray-100)]"
                style={{ width: `${(r.views / max) * 100}%` }}
              />
              <span className="relative min-w-0 truncate font-mono text-[13px]">{r.label}</span>
              <span className="tabular relative shrink-0 text-[13px] text-muted-foreground">
                {number.format(r.views)}
                <span className="sr-only"> {unit}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
