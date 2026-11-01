import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ReceiptActions } from "@/components/ReceiptActions";
import { TrialChart } from "@/components/TrialChart";
import { VerdictBadge } from "@/components/VerdictBadge";
import { Skeleton } from "@/components/ui";
import { db } from "@/lib/db";
import type { VerdictLabel } from "@/lib/stats";
import { loadTrialBundle } from "@/lib/trial-data";

export const metadata: Metadata = { title: "Receipt", robots: { index: false } };

export default function ReceiptPage({ params }: PageProps<"/r/[slug]">) {
  return (
    <Suspense fallback={<Skeleton className="h-[640px]" />}>
      <Receipt params={params} />
    </Suspense>
  );
}

const fmt = (x: number | null | undefined) => (x == null ? "–" : `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(1)}`);

async function Receipt({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t = await db.trial.findUnique({ where: { shareSlug: slug }, select: { id: true } });
  if (!t) notFound();
  const b = (await loadTrialBundle(t.id))!;
  const { trial, protocol, analysis: r, meta } = b;
  if (!protocol || !r || !meta || !trial.lockedAt) notFound();
  const v = b.verdict;
  const fresh = v && v.headline === b.headline && v.label === r.label && v.nBaseline === r.nBaseline && v.nTreatment === r.nTreatment;
  const planned = (trial.baselineDays ?? 0) + (trial.treatmentDays ?? 0);
  const mock = b.captures.some((c) => c.mock);
  const first = b.captures[0]?.capturedAt;
  const last = b.captures.at(-1)?.capturedAt;

  return (
    <div className="space-y-4">
      <article id="receipt" className="rounded-3xl border border-line bg-surface p-5 sm:p-7" data-testid="receipt">
        <header className="flex items-start justify-between gap-4 border-b border-dashed border-line pb-4">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">Receipt · n=1 trial</div>
            <h1 className="mt-1 text-xl font-semibold tracking-tight">{trial.productName}</h1>
            {trial.brand && <div className="text-sm text-ink-2">{trial.brand}</div>}
          </div>
          <VerdictBadge label={r.label as VerdictLabel} size="lg" interim={r.interim} experimental={trial.design === "split_face"} />
        </header>

        <section className="grid gap-1 border-b border-dashed border-line py-4 text-sm">
          <Row k="Claim" v={`“${trial.claimText}”`} />
          <Row k="Design" v={trial.design === "split_face" ? `Split-face, product on ${trial.treatedSide} side, other side as control` : "Before/after with baseline"} />
          <Row k="Measured" v={`${meta.concernLabel}: ${meta.label} (YouCam AI Skin Analysis)`} />
          <Row k="Schedule" v={`${trial.baselineDays} baseline + ${trial.treatmentDays} treatment days${trial.washInDays ? `, first ${trial.washInDays} not counted` : ""}`} />
          <Row k="Matters if" v={`≥ ${trial.sesoi} ${meta.unit} (set before day 1)`} />
        </section>

        <section className="border-b border-dashed border-line py-4">
          <p className="text-lg font-medium leading-snug text-pretty">{fresh ? v!.headline : b.headline}</p>
          <div className="mt-3 grid grid-cols-3 gap-3 text-sm tabular">
            <div><div className="text-xs text-muted">Effect</div><div className="font-medium">{fmt(r.effect)} {r.effect != null && meta.unit}</div></div>
            <div><div className="text-xs text-muted">95% interval</div><div className="font-medium">{r.ciLow == null ? "–" : `${fmt(r.ciLow)} to ${fmt(r.ciHigh)}`}</div></div>
            <div><div className="text-xs text-muted">Days</div><div className="font-medium">{b.daysLogged} of {planned}</div></div>
          </div>
          <p className="mt-3 text-xs text-muted">Approximate, model-based interval; repeated looks are exploratory. {trial.design === "split_face" && "Cheek-patch mask intensity is an unvalidated proxy."}</p>
        </section>

        <section className="py-4">
          <TrialChart
            design={trial.design as "split_face" | "pre_post"}
            series={b.series}
            trajectory={r.trajectory}
            baselineDays={trial.baselineDays ?? 0}
            plannedDays={planned}
            washInDays={trial.washInDays}
            sesoi={trial.sesoi ?? 1}
            unit={meta.unit}
            title={`${meta.concernLabel} · ${meta.label}`}
            higherIsBetter={meta.higherIsBetter}
            treatedSide={trial.treatedSide}
          />
        </section>

        <footer className="flex flex-wrap items-end justify-between gap-2 border-t border-dashed border-line pt-4 text-[11px] text-muted tabular">
          <div>
            {first && last && `${first.toISOString().slice(0, 10)} → ${last.toISOString().slice(0, 10)} · `}
            protocol <span className="font-mono">#{trial.protocolHash?.slice(0, 10)}</span> locked {trial.lockedAt.toISOString().slice(0, 10)}
            {mock && <span className="ml-1 font-medium text-warn">· DEMO / MOCK DATA</span>}
          </div>
          <div>Receipts · one person, AI-estimated scores, not medical advice</div>
        </footer>
      </article>
      <ReceiptActions fileName={`receipt-${trial.productName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`} />
      <p className="text-center text-xs text-muted">
        <Link href={`/trials/${trial.id}`} className="underline underline-offset-2">Open the full trial</Link>
      </p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[88px_1fr] gap-3">
      <span className="text-muted">{k}</span>
      <span className="text-ink">{v}</span>
    </div>
  );
}
