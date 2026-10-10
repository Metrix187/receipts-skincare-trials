import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { findVisibleTrial } from "@/lib/owner";
import type { Tier } from "@/lib/youcam/concerns";
import { MIN_SHORT_SIDE, unitsPerAnalysis } from "@/lib/youcam/costs";
import { CaptureClient } from "./CaptureClient";

export const metadata: Metadata = { title: "Today's photo" };

export default function CapturePage({ params }: PageProps<"/trials/[id]/capture">) {
  return (
    <Suspense fallback={<Skeleton className="h-[480px]" />}>
      <Capture params={params} />
    </Suspense>
  );
}

async function Capture({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const found = await findVisibleTrial(id);
  if (!found?.canEdit || !found.trial.lockedAt) notFound();
  const t = found.trial;

  // Reference brightness: median face luminance of earlier counted captures.
  const prev = await db.capture.findMany({ where: { trialId: id, counts: true }, select: { quality: true } });
  const lums = prev.map((c) => Number((c.quality as { luminance?: number } | null)?.luminance)).filter(Number.isFinite).sort((a, b) => a - b);
  const referenceLuma = lums.length ? lums[Math.floor(lums.length / 2)] : null;
  const concerns = (t.concerns as string[] | null) ?? [];

  const instruction =
    t.design === "split_face"
      ? `Take the photo before applying anything. Your product goes on your ${t.treatedSide} side only (after the baseline days).`
      : "Take the photo before applying anything, in your usual spot and light.";

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Today&apos;s photo</h1>
        <Link href={`/trials/${id}`} className="text-sm text-ink-2 underline underline-offset-2">Back</Link>
      </div>
      <CaptureClient
        trialId={id}
        design={t.design as "split_face" | "pre_post"}
        treatedSide={t.treatedSide}
        tier={t.tier}
        minShortSide={MIN_SHORT_SIDE[t.tier as Tier]}
        unitsPerCall={unitsPerAnalysis(t.tier as Tier, Math.max(1, concerns.length))}
        mock={env().youcamMock}
        captureTime={t.captureTime ?? "08:00"}
        referenceLuma={referenceLuma}
        instruction={instruction}
      />
    </div>
  );
}
