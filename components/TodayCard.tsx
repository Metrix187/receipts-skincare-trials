"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { btn, Card } from "./ui";

export function localDateString(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayIndex(startDate: string, local: string) {
  const [a, b, c] = startDate.split("-").map(Number);
  const [x, y, z] = local.split("-").map(Number);
  return Math.round((Date.UTC(x, y - 1, z) - Date.UTC(a, b - 1, c)) / 86_400_000);
}

export function TodayCard(p: {
  trialId: string;
  startDate: string;
  baselineDays: number;
  plannedDays: number;
  design: "split_face" | "pre_post";
  treatedSide: string | null;
  captureTime: string;
  loggedDays: number[];
}) {
  const [today, setToday] = useState<number | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the user's local date is only known in the browser
    setToday(dayIndex(p.startDate, localDateString()));
  }, [p.startDate]);

  if (today === null) return <Card className="h-28 animate-pulse">{null}</Card>;

  const done = p.loggedDays.includes(today);
  const baseline = today < p.baselineDays;
  const finished = today >= p.plannedDays;

  let instruction: string;
  if (today < 0) instruction = `Your trial starts in ${-today} day${today === -1 ? "" : "s"}.`;
  else if (baseline) instruction = `Baseline day ${today + 1} of ${p.baselineDays}: don't use the product yet. Just take the photo.`;
  else if (p.design === "split_face") instruction = `Treatment day ${today - p.baselineDays + 1}: photo first, then apply the product to your ${p.treatedSide} side only.`;
  else instruction = `Treatment day ${today - p.baselineDays + 1}: photo first, then use the product as usual.`;
  if (finished) instruction = "The planned period is over. You can keep logging if the verdict asks for more days.";

  return (
    <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" data-testid="today-card">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-muted">
          Today · day {Math.max(0, today)} {baseline ? "· baseline" : today >= 0 ? "· treatment" : ""}
        </div>
        <p className="mt-1 text-[15px] text-ink">{instruction}</p>
        <p className="text-xs text-muted">Best around {p.captureTime}, same light as yesterday.</p>
      </div>
      {today >= 0 &&
        (done ? (
          <span className="rounded-full bg-good-bg px-3 py-1.5 text-sm font-medium text-good" data-testid="done-today">
            <span aria-hidden>✓</span> Logged today
          </span>
        ) : (
          <Link href={`/trials/${p.trialId}/capture`} className={btn.primary} data-testid="take-selfie">
            Take today&apos;s photo
          </Link>
        ))}
    </Card>
  );
}
