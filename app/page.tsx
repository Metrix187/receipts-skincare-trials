import Link from "next/link";
import { Suspense } from "react";
import { db } from "@/lib/db";
import { ownerId } from "@/lib/owner";
import type { VerdictLabel } from "@/lib/stats";
import { concern, type ConcernKey } from "@/lib/youcam/concerns";
import { VerdictBadge } from "@/components/VerdictBadge";
import { PrivacyNote } from "@/components/PrivacyNote";
import { btn, Card, Skeleton } from "@/components/ui";

export default function Home() {
  return (
    <div className="space-y-8">
      <section className="pt-2">
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">Is it actually working?</h1>
        <p className="mt-3 max-w-prose text-[15px] leading-relaxed text-ink-2">
          Receipts runs an honest n=1 trial of your skincare. An agent designs the experiment (often product on one
          side of your face only), YouCam AI Skin Analysis measures you every day, and the verdict comes with its
          uncertainty. If there isn&apos;t enough data, it says so.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/trials/new" className={btn.primary} data-testid="start-trial">Start a trial</Link>
          <Link href="/demo" className={btn.secondary}>See a finished 21-day trial</Link>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Your trials</h2>
        <Suspense fallback={<Skeleton />}>
          <TrialList />
        </Suspense>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        {[
          ["1 · Design", "The Protocol Agent picks split-face or before/after, the metric that matches the claim, and the smallest change worth caring about. Then it's locked."],
          ["2 · Measure", "One selfie a day, checked for lighting, framing and pose before any YouCam units are spent."],
          ["3 · Verdict", "A pre-registered analysis with a 95% interval. The Verdict Agent explains it but can't change it."],
        ].map(([t, d]) => (
          <Card key={t} className="p-4">
            <div className="text-sm font-medium">{t}</div>
            <p className="mt-1 text-sm text-ink-2">{d}</p>
          </Card>
        ))}
      </section>

      <PrivacyNote />
    </div>
  );
}

async function TrialList() {
  const owner = await ownerId();
  const trials = await db.trial.findMany({
    where: { OR: [{ ownerId: owner }, { isDemo: true }] },
    orderBy: [{ isDemo: "asc" }, { createdAt: "desc" }],
    include: {
      verdicts: { orderBy: { createdAt: "desc" }, take: 1 },
      _count: { select: { captures: { where: { counts: true } } } },
    },
  });
  if (!trials.length) {
    return <p className="text-sm text-muted">No trials yet.</p>;
  }
  return (
    <ul className="space-y-2">
      {trials.map((t) => {
        const total = (t.baselineDays ?? 0) + (t.treatmentDays ?? 0);
        const v = t.verdicts[0];
        return (
          <li key={t.id}>
            <Link href={`/trials/${t.id}`} className="block rounded-2xl border border-line bg-surface p-4 transition hover:bg-surface-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-medium">
                    {t.productName}
                    {t.isDemo && <span className="ml-2 rounded-full bg-neutral-bg px-2 py-0.5 text-[11px] text-ink-2">demo</span>}
                  </div>
                  <div className="truncate text-sm text-ink-2">“{t.claimText}”</div>
                </div>
                {v ? <VerdictBadge label={v.label as VerdictLabel} experimental={t.design === "split_face"} /> : <span className="text-xs text-muted">{t.status === "draft" ? "draft" : "running"}</span>}
              </div>
              <div className="mt-2 text-xs text-muted tabular">
                {t.primaryConcern ? `${concern(t.primaryConcern as ConcernKey).label} · ` : ""}
                {t.design === "split_face" ? "split-face" : t.design === "pre_post" ? "before/after" : "designing"}
                {total > 0 && ` · ${t._count.captures}/${total} days logged`}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
