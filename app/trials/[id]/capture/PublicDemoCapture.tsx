"use client";

import Link from "next/link";
import { useState } from "react";
import { btn } from "@/components/ui";
import { localDateString } from "@/components/TodayCard";
import type { CaptureView } from "@/lib/capture-view";

export function PublicDemoCapture({ trialId }: { trialId: string }) {
  const [result, setResult] = useState<CaptureView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run() {
    setBusy(true); setError("");
    try {
      let response = await fetch(`/api/trials/${trialId}/demo-capture`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ localDate: localDateString() }) });
      let data = await response.json();
      if (!response.ok) throw new Error(data.error || "Demo check-in failed.");
      for (let i = 0; data.status === "analyzing" && i < 20; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        response = await fetch(`/api/captures/${data.id}`);
        data = await response.json();
        if (!response.ok) throw new Error(data.error || "Demo check-in failed.");
      }
      setResult(data);
    } catch (e) { setError(e instanceof Error ? e.message : "Demo check-in failed."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-4">
    <div className="rounded-2xl border border-line bg-surface p-5 text-sm text-ink-2">
      <p className="font-semibold text-ink">Public demo · synthetic sample</p>
      <p className="mt-2">No selfie is needed or accepted here. The app generates a sample and simulated analysis locally on the server. Face detection and quality checks are simulated in this public preview.</p>
    </div>
    {!result && <button className={btn.primary} disabled={busy} onClick={run} data-testid="demo-check-in">{busy ? "Running simulated check-in…" : "Run synthetic check-in · 0 units"}</button>}
    {error && <p role="alert" className="text-sm text-crit">{error}</p>}
    {result && <div className="rounded-2xl bg-good-bg p-4 text-sm" data-testid="capture-result">
      {result.status === "success" ? `✓ Day ${result.dayIndex} logged (synthetic mock analysis).` : result.status === "analyzing" ? "Still analyzing; check the trial page." : `Analysis failed: ${result.error?.message ?? "try again"}`}
      <div className="mt-3"><Link href={`/trials/${trialId}`} className={btn.primary} data-testid="back-to-trial">Back to trial</Link></div>
    </div>}
  </div>;
}
