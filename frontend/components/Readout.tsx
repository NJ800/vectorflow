/**
 * One cell of an instrument readout strip: a quiet label over a large numeral.
 * Numbers are the point of this app, so they get the display face.
 */
export function Readout({
  label,
  value,
  unit,
  tone = "ink",
  title,
}: {
  label: string;
  value: string;
  unit?: string;
  /** "live" is accent -- reserved for genuine live/active signals (e.g. a
   *  "computed just now" source). "brand" is for ranked/emphasised data
   *  that isn't a live event (e.g. a top score) -- accent must not become a
   *  general-purpose emphasis colour. */
  tone?: "ink" | "live" | "brand" | "muted";
  title?: string;
}) {
  const toneClass =
    tone === "live"
      ? "text-accent-text"
      : tone === "brand"
        ? "text-brand"
        : tone === "muted"
          ? "text-muted"
          : "text-ink";

  return (
    <div className="min-w-0 px-4 py-3 first:pl-0">
      <div className="text-[11px] leading-none tracking-wide text-muted">
        {label}
      </div>
      <div
        title={title}
        className={`mt-1.5 truncate font-display text-2xl leading-none tabular-nums ${toneClass}`}
      >
        {value}
        {unit ? (
          <span className="ml-1 font-body text-xs text-muted">{unit}</span>
        ) : null}
      </div>
    </div>
  );
}

/** Hairline-divided container for a row of readouts. */
export function ReadoutStrip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-stretch divide-x divide-border border-y border-border">
      {children}
    </div>
  );
}
