import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActionButton } from "@/components/ActionButton";
import { AgentLog } from "@/components/AgentLog";
import { DayStrip } from "@/components/DayStrip";
import { PrivacyNote } from "@/components/PrivacyNote";
import { ProtocolCard } from "@/components/ProtocolCard";
import { TodayCard } from "@/components/TodayCard";
import { TrialChart } from "@/components/TrialChart";
import { VerdictPanel } from "@/components/VerdictPanel";
import { btn, Card, CardTitle, Skeleton } from "@/components/ui";
import { findVisibleTrial } from "@/lib/owner";
import { loadTrialBundle } from "@/lib/trial-data";

export default function TrialPage({ params }: PageProps<"/trials/[id]">) {
  return (
    <Suspense fallback={<div className="space-y-4"><Skeleton className="h-16" /><Skeleton className="h-64" /><Skeleton className="h-96" /></div>}>
      <TrialView params={params} />
    </Suspense>
  );
}

async function TrialView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const found = await findVisibleTrial(id);
  if (!found) notFound();
  const b = (await loadTrialBundle(id))!;
  const { trial, protocol } = b;
  const canEdit = found.canEdit;
  const protocolRuns = b.runs.filter((r) => r.agent === "protocol");
  const verdictRuns = b.runs.filter((r) => r.agent === "verdict");
  const planned = (trial.baselineDays ?? 0) + (trial.treatmentDays ?? 0);
  const liveUnits = b.allCaptures.filter((c) => !c.mock && c.status === "success").reduce((s, c) => s + c.units, 0);

  return (
    <div className="space-y-5">
      <header>
        <div className="text-xs text-muted">{trial.brand ?? "Trial"}{trial.isDemo && " · demo (read-only)"}</div>
        <h1 className="text-2xl font-semibold tracking-tight">{trial.productName}</h1>
        <p className="mt-1 text-ink-2">“{trial.claimText}”</p>
      </header>

      {!protocol && (
        <Card>
          <CardTitle>Protocol</CardTitle>
          <p className="text-sm text-ink-2">The Protocol Agent couldn&apos;t finish a design. Nothing was spent.</p>
          {canEdit && <ActionButton className="mt-3" endpoint={`/api/trials/${id}/protocol`} busy="Designing…">Try again</ActionButton>}
          {protocolRuns.map((r) => <div key={r.id} className="mt-3"><AgentLog run={r} /></div>)}
        </Card>
      )}

      {protocol && !trial.lockedAt && (
        <>
          <ProtocolCard trial={trial} protocol={protocol} />
          {protocolRuns.length > 0 && <AgentLog run={protocolRuns.at(-1)!} />}
          {canEdit && (
            <Card>
              <p className="text-sm text-ink-2">
                Locking pre-registers this plan: the metric, the smallest change that matters and the analysis are frozen
                and hashed before your first photo, so the verdict can&apos;t be tuned after the fact.
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <ActionButton endpoint={`/api/trials/${id}/lock`} busy="Locking…" testId="lock-protocol">Lock protocol &amp; start</ActionButton>
                <ActionButton endpoint={`/api/trials/${id}/protocol`} variant="secondary" busy="Redesigning…">Ask for a different design</ActionButton>
              </div>
            </Card>
          )}
        </>
      )}

      {protocol && trial.lockedAt && (
        <>
          {canEdit && (
            <TodayCard
              trialId={id}
              startDate={trial.startDate.toISOString().slice(0, 10)}
              baselineDays={trial.baselineDays ?? 0}
              plannedDays={planned}
              design={trial.design as "split_face" | "pre_post"}
              treatedSide={trial.treatedSide}
              captureTime={trial.captureTime ?? "08:00"}
              loggedDays={b.captures.map((c) => c.dayIndex)}
            />
          )}

          <VerdictPanel bundle={b} canEdit={canEdit} />

          <Card>
            {b.meta && b.analysis && (
              <TrialChart
                design={trial.design as "split_face" | "pre_post"}
                series={b.series}
                trajectory={b.analysis.trajectory}
                baselineDays={trial.baselineDays ?? 0}
                plannedDays={planned}
                washInDays={trial.washInDays}
                sesoi={trial.sesoi ?? 1}
                unit={b.meta.unit}
                title={`${b.meta.concernLabel} · ${b.meta.label}${trial.design === "split_face" ? " per side" : ""}`}
                higherIsBetter={b.meta.higherIsBetter}
                treatedSide={trial.treatedSide}
              />
            )}
            <div className="mt-4">
              <DayStrip planned={planned} baselineDays={trial.baselineDays ?? 0} captures={b.allCaptures} />
            </div>
          </Card>

          <div className="flex flex-wrap gap-3">
            <Link href={`/r/${trial.shareSlug}`} className={btn.secondary} data-testid="open-receipt">Open shareable receipt</Link>
          </div>

          <ProtocolCard trial={trial} protocol={protocol} />

          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Agent logs</h2>
            {[...verdictRuns].reverse().slice(0, 3).map((r) => <AgentLog key={r.id} run={r} />)}
            {protocolRuns.length > 0 && <AgentLog run={protocolRuns.at(-1)!} />}
          </section>

          {canEdit && (
            <Card>
              <CardTitle>Your data</CardTitle>
              <p className="text-sm text-ink-2 tabular">
                {b.photosStored} encrypted photo{b.photosStored === 1 ? "" : "s"} stored · {b.allCaptures.length} capture
                {b.allCaptures.length === 1 ? "" : "s"} · {liveUnits} real YouCam units used
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <ActionButton
                  endpoint={`/api/trials/${id}/photos`}
                  method="DELETE"
                  variant="danger"
                  confirm="Delete every stored photo for this trial? Scores and the verdict are kept."
                  busy="Deleting…"
                  testId="delete-photos"
                >
                  Delete all photos
                </ActionButton>
                <ActionButton
                  endpoint={`/api/trials/${id}`}
                  method="DELETE"
                  variant="danger"
                  confirm="Delete this whole trial: photos, scores, verdicts and agent logs? This can't be undone."
                  busy="Deleting…"
                  redirectTo="/"
                >
                  Delete trial
                </ActionButton>
              </div>
            </Card>
          )}
          <PrivacyNote compact />
        </>
      )}
    </div>
  );
}
