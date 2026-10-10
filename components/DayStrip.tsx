interface CaptureLite {
  dayIndex: number;
  status: string;
  counts: boolean;
}

/** One cell per planned day: filled = counted, ring = attempted but failed, empty = not yet. */
export function DayStrip({ planned, baselineDays, captures }: { planned: number; baselineDays: number; captures: CaptureLite[] }) {
  const lastDay = Math.max(planned - 1, ...captures.map((c) => c.dayIndex));
  const cells = Array.from({ length: lastDay + 1 }, (_, day) => {
    const cs = captures.filter((c) => c.dayIndex === day);
    return { day, counted: cs.some((c) => c.counts), failed: cs.length > 0 && !cs.some((c) => c.counts), baseline: day < baselineDays };
  });
  const counted = cells.filter((c) => c.counted).length;
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-xs text-muted tabular">
        <span>Daily log</span>
        <span>{counted} of {planned} days</span>
      </div>
      <ol className="flex flex-wrap gap-1" aria-label="Days logged">
        {cells.map((c) => (
          <li
            key={c.day}
            title={`Day ${c.day} (${c.baseline ? "baseline" : "treatment"}): ${c.counted ? "logged" : c.failed ? "failed capture" : "not logged"}`}
            className={`h-3 w-3 rounded-[3px] ${
              c.counted ? (c.baseline ? "bg-ink-2" : "bg-treated") : c.failed ? "border border-crit" : c.baseline ? "bg-surface-2 border border-line" : "border border-line"
            }`}
          />
        ))}
      </ol>
      <div className="mt-1.5 flex gap-3 text-[11px] text-muted">
        <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-ink-2" />baseline</span>
        <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-treated" />treatment</span>
        <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-sm border border-crit" />failed (no units)</span>
      </div>
    </div>
  );
}
