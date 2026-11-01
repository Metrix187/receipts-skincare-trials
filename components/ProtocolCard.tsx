import type { Trial } from "@prisma/client";
import type { Protocol } from "@/lib/protocol";
import { METRIC_META } from "@/lib/protocol";
import { concern, type ConcernKey } from "@/lib/youcam/concerns";
import { projectTrialUnits } from "@/lib/youcam/costs";
import type { Tier } from "@/lib/youcam/concerns";
import { Card, CardTitle, Stat } from "./ui";

export function ProtocolCard({ trial, protocol: p }: { trial: Trial; protocol: Protocol }) {
  const meta = METRIC_META[p.primary_metric];
  const days = p.baseline_days + p.treatment_days;
  const units = projectTrialUnits({ tier: trial.tier as Tier, concernCount: 1 + p.secondary_concerns.length, days });
  const split = p.design === "split_face";
  return (
    <Card data-testid="protocol-card">
      <CardTitle
        aside={
          trial.lockedAt ? (
            <span className="text-xs text-muted" title={trial.protocolHash ?? ""}>
              Locked {trial.lockedAt.toISOString().slice(0, 10)} · <span className="font-mono">#{trial.protocolHash?.slice(0, 8)}</span>
            </span>
          ) : (
            <span className="rounded-full bg-warn-bg px-2 py-0.5 text-xs text-warn">Draft: not locked</span>
          )
        }
      >
        Protocol
      </CardTitle>
      <p className="text-[15px] leading-relaxed text-ink">{p.plain_summary}</p>
      {split && <p className="mt-3 rounded-lg bg-warn-bg p-3 text-xs text-warn">Experimental measurement: small approximate cheek patches sample YouCam mask intensity. This proxy is not validated across skin tones, facial hair, lighting or products; it is not a medical measurement.</p>}

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Design" value={split ? "Split-face" : "Before / after"} hint={split ? `Product on ${p.treated_side} side` : "Whole face"} />
        <Stat label="Measures" value={concern(p.primary_concern as ConcernKey).label} hint={meta.label} />
        <Stat label="Schedule" value={`${p.baseline_days} + ${p.treatment_days} days`} hint={p.wash_in_days ? `first ${p.wash_in_days} treatment days not counted` : "baseline + treatment"} />
        <Stat label="Matters if ≥" value={`${p.sesoi} ${meta.unit}`} hint="smallest change worth it" />
      </div>

      <dl className="mt-4 space-y-3 text-sm">
        <div>
          <dt className="text-xs font-medium text-muted">Why this design</dt>
          <dd className="text-ink-2">{p.design_rationale}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted">Why this measurement</dt>
          <dd className="text-ink-2">{p.metric_rationale}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted">Why {p.sesoi} {meta.unit}</dt>
          <dd className="text-ink-2">{p.sesoi_rationale}</dd>
        </div>
        {p.secondary_concerns.length > 0 && (
          <div>
            <dt className="text-xs font-medium text-muted">Also recorded (descriptive only, never tested)</dt>
            <dd className="text-ink-2">{p.secondary_concerns.map((c) => concern(c as ConcernKey).label).join(", ")}</dd>
          </div>
        )}
        <div>
          <dt className="text-xs font-medium text-muted">Daily capture · around {p.capture_time}</dt>
          <dd>
            <ul className="list-disc space-y-0.5 pl-5 text-ink-2">
              {p.capture_instructions.map((s) => <li key={s}>{s}</li>)}
            </ul>
          </dd>
        </div>
        {!p.claim_testable && (
          <div className="rounded-lg bg-warn-bg p-3 text-warn">
            A selfie can&apos;t see what this claim describes. This trial tests the closest visible proxy only.
          </div>
        )}
        {p.caveats.length > 0 && (
          <div>
            <dt className="text-xs font-medium text-muted">Caveats</dt>
            <dd>
              <ul className="list-disc space-y-0.5 pl-5 text-ink-2">
                {p.caveats.map((s) => <li key={s}>{s}</li>)}
              </ul>
            </dd>
          </div>
        )}
        <div className="rounded-lg bg-surface-2 p-3 text-xs text-ink-2 tabular">
          YouCam cost: {units.unitsPerCall} units per daily analysis ({trial.tier.toUpperCase()}, {1 + p.secondary_concerns.length} concerns) ≈{" "}
          <span className="font-medium text-ink">{units.totalUnits} units</span> for {days} days. Rejected photos and failed analyses cost nothing.
        </div>
      </dl>
    </Card>
  );
}
