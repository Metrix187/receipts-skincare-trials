"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { btn } from "@/components/ui";

const APPLICATIONS = [
  ["leave_on_topical", "Leave-on", "serum, cream, toner"],
  ["wash_off_topical", "Wash-off", "cleanser, mask"],
  ["oral", "Oral", "supplement, pill"],
  ["device_or_procedure", "Device", "LED, microneedling"],
  ["other", "Other", ""],
] as const;

const EXAMPLES = ["Reduces redness in 4 weeks", "Visibly smaller pores in 14 days", "Clearer skin in 30 days", "Brighter, more radiant skin in 2 weeks"];

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const field = "mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-[15px] text-ink placeholder:text-muted focus:border-ink-2 focus:outline-none";

export function NewTrialForm() {
  const router = useRouter();
  const [application, setApplication] = useState<string>("leave_on_topical");
  const [half, setHalf] = useState<string>("yes");
  const [claim, setClaim] = useState("");
  const [pending, setPending] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- local date is only known in the browser
    setStartDate(today());
  }, []);

  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [pending]);

  const topical = application === "leave_on_topical" || application === "wash_off_topical";

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPending(true);
    setElapsed(0);
    setError(null);
    try {
      const res = await fetch("/api/trials", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          productName: f.get("productName"),
          brand: f.get("brand") || undefined,
          claimText: claim,
          application,
          canApplyToHalfFace: topical ? half : "no",
          startDate: f.get("startDate"),
          notes: f.get("notes") || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Couldn't create the trial");
      router.push(`/trials/${body.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPending(false);
    }
  }

  if (pending) {
    const steps = ["Reading the claim", "Choosing what YouCam should measure", "Deciding split-face vs before/after", "Setting the smallest change worth caring about", "Checking the design rules"];
    return (
      <div className="rounded-2xl border border-line bg-surface p-6" role="status" aria-live="polite" data-testid="designing">
        <div className="text-sm font-medium">The Protocol Agent is designing your trial… <span className="text-muted tabular">{elapsed}s</span></div>
        <ul className="mt-4 space-y-2 text-sm">
          {steps.map((s, i) => (
            <li key={s} className={i <= Math.floor(elapsed / 4) ? "text-ink" : "text-muted"}>
              <span aria-hidden className="mr-2">{i < Math.floor(elapsed / 4) ? "✓" : i === Math.floor(elapsed / 4) ? "•" : "○"}</span>
              {s}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          Product
          <input name="productName" required minLength={2} maxLength={80} placeholder="Azelaic acid 10% serum" className={field} data-testid="product" />
        </label>
        <label className="block text-sm font-medium">
          Brand <span className="font-normal text-muted">(optional)</span>
          <input name="brand" maxLength={60} className={field} />
        </label>
      </div>

      <label className="block text-sm font-medium">
        What does it claim?
        <input
          name="claimText"
          required
          minLength={5}
          maxLength={240}
          value={claim}
          onChange={(e) => setClaim(e.target.value)}
          placeholder="Reduces redness in 4 weeks"
          className={field}
          data-testid="claim"
        />
      </label>
      <div className="-mt-3 flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" onClick={() => setClaim(ex)} className="rounded-full border border-line px-3 py-1 text-xs text-ink-2 hover:bg-surface-2">
            {ex}
          </button>
        ))}
      </div>

      <fieldset>
        <legend className="text-sm font-medium">How do you use it?</legend>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {APPLICATIONS.map(([value, label, hint]) => (
            <label key={value} className={`cursor-pointer rounded-xl border p-3 text-sm ${application === value ? "border-ink bg-surface-2" : "border-line bg-surface"}`}>
              <input type="radio" name="application" value={value} checked={application === value} onChange={() => setApplication(value)} className="sr-only" />
              <div className="font-medium">{label}</div>
              {hint && <div className="text-xs text-muted">{hint}</div>}
            </label>
          ))}
        </div>
      </fieldset>

      {topical && (
        <fieldset>
          <legend className="text-sm font-medium">Could you apply it to only one half of your face for a few weeks?</legend>
          <p className="text-xs text-muted">That&apos;s the strongest test: your other half becomes the control.</p>
          <div className="mt-2 flex gap-2">
            {(["yes", "unsure", "no"] as const).map((v) => (
              <label key={v} className={`cursor-pointer rounded-xl border px-4 py-2 text-sm capitalize ${half === v ? "border-ink bg-surface-2" : "border-line bg-surface"}`}>
                <input type="radio" name="half" value={v} checked={half === v} onChange={() => setHalf(v)} className="sr-only" />
                {v}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          Start date
          <input type="date" name="startDate" required value={startDate} onChange={(e) => setStartDate(e.target.value)} className={field} />
        </label>
        <label className="block text-sm font-medium">
          Notes <span className="font-normal text-muted">(optional)</span>
          <input name="notes" maxLength={400} placeholder="e.g. I also use a daily SPF" className={field} />
        </label>
      </div>

      {error && <p className="text-sm text-crit" role="alert">{error}</p>}
      <button type="submit" className={`${btn.primary} w-full sm:w-auto`} data-testid="design-trial">Design my trial</button>
    </form>
  );
}
