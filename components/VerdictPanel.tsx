import type { TrialBundle } from "@/lib/trial-data";
import type { VerdictLabel } from "@/lib/stats";
import { ActionButton } from "./ActionButton";
import { VerdictBadge } from "./VerdictBadge";
import { Card, CardTitle, Stat } from "./ui";

const fmt = (x: number | null | undefined, d = 1) => (x == null ? "–" : `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(d)}`);

export function VerdictPanel({ bundle: b, canEdit }: { bundle: TrialBundle; canEdit: boolean }) {
  const r = b.analysis;
  if (!r || !b.meta) return null;
  const v = b.verdict;
  // A stored verdict is current only if it saw exactly the days we have now.
  const fresh = v && v.nBaseline === r.nBaseline && v.nTreatment === r.nTreatment;
  const stats = (v?.stats ?? {}) as { caveats?: string[]; nextStep?: string };
  const label = r.label as VerdictLabel;

  return (
    <Card data-testid="verdict-panel">
      <CardTitle aside={<VerdictBadge label={label} />}>Verdict</CardTitle>
      <p className="text-lg font-medium leading-snug text-ink text-pretty" data-testid="verdict-headline">
        {fresh ? v!.headline : b.headline}
      </p>
      {fresh && <p className="mt-2 text-sm leading-relaxed text-ink-2">{v!.explanation}</p>}

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Effect (+ = better)" value={r.effect == null ? "–" : `${fmt(r.effect)} ${b.meta.unit}`} />
        <Stat label="95% interval" value={r.ciLow == null ? "–" : `${fmt(r.ciLow)} to ${fmt(r.ciHigh)}`} />
        <Stat label="Days analyzed" value={`${r.nBaseline} + ${r.nTreatment}`} hint={r.nExcludedWashIn ? `${r.nExcludedWashIn} wash-in excluded` : "baseline + treatment"} />
        <Stat
          label="Come back in"
          value={r.daysRemaining.overall == null ? "–" : r.daysRemaining.overall === 0 ? "done" : `${r.daysRemaining.overall} days`}
          hint={r.daysRemaining.timeframe ? `claim timeframe: ${r.daysRemaining.timeframe}d left` : undefined}
        />
      </div>
      <p className="mt-3 text-xs text-muted">{r.daysRemaining.note}</p>

      {fresh && (stats.caveats?.length || stats.nextStep) && (
        <div className="mt-4 space-y-2 text-sm">
          {stats.nextStep && <p><span className="font-medium">Next: </span><span className="text-ink-2">{stats.nextStep}</span></p>}
          {!!stats.caveats?.length && (
            <ul className="list-disc space-y-0.5 pl-5 text-ink-2">
              {stats.caveats.map((c) => <li key={c}>{c}</li>)}
            </ul>
          )}
        </div>
      )}

      {canEdit && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <ActionButton endpoint={`/api/trials/${b.trial.id}/verdict`} busy="Verdict Agent is reading your data…" variant={fresh ? "secondary" : "primary"} testId="run-verdict">
            {fresh ? "Re-run Verdict Agent" : v ? "Update verdict with new days" : "Ask the Verdict Agent"}
          </ActionButton>
        </div>
      )}
      <p className="mt-3 text-[11px] text-muted">
        The label and numbers come from the locked analysis ({r.method?.name ?? "not run yet"}). The agent writes the words and is
        rejected if it disagrees with the math or overclaims.
      </p>
    </Card>
  );
}
