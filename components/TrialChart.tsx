"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";

export interface ChartPoint {
  day: number;
  phase: "baseline" | "treatment";
  treated?: number;
  control?: number;
  value?: number;
}
export interface ChartTrajectoryPoint {
  day: number;
  effect: number;
  lo: number;
  hi: number;
}
export interface TrialChartProps {
  design: "split_face" | "pre_post";
  series: ChartPoint[];
  trajectory: ChartTrajectoryPoint[];
  baselineDays: number;
  plannedDays: number;
  washInDays: number;
  sesoi: number;
  unit: string;
  /** e.g. "Redness · % of cheek flagged" */
  title: string;
  higherIsBetter: boolean;
  treatedSide?: string | null;
}

const H_TOP = 200;
const H_BOTTOM = 130;
const GAP = 46;
const M = { l: 40, r: 92, t: 22, b: 26 };

/** Clean ticks on a domain rounded OUTWARD to whole steps, so the data always fits. */
function niceScale(lo: number, hi: number, count = 4) {
  const span = hi - lo || 1;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step * 1e-6; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { ticks, lo: start, hi: end };
}

const fmt = (x: number, d = 1) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(d)}`;

function useWidth<T extends HTMLElement>(fallback = 640) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(300, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function TrialChart(p: TrialChartProps) {
  const [wrapRef, W] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const split = p.design === "split_face";
  const H = M.t + H_TOP + GAP + H_BOTTOM + M.b;

  const lastDay = Math.max(p.plannedDays - 1, ...p.series.map((d) => d.day), 1);
  const x = (day: number) => M.l + ((day + 0.5) / (lastDay + 1)) * (W - M.l - M.r);

  // Top panel scale
  const vals = p.series.flatMap((d) => (split ? [d.treated, d.control] : [d.value])).filter((v): v is number => v != null);
  const [vLo, vHi] = vals.length ? [Math.min(...vals), Math.max(...vals)] : [0, 10];
  const pad = Math.max(0.5, (vHi - vLo) * 0.08);
  const top = niceScale(Math.max(0, vLo - pad), vHi + pad);
  const topTicks = top.ticks;
  const yTop = (v: number) => M.t + H_TOP - ((v - top.lo) / (top.hi - top.lo || 1)) * H_TOP;

  // Bottom panel scale (effect, positive = better)
  const bTop = M.t + H_TOP + GAP;
  const effVals = p.trajectory.flatMap((t) => [t.lo, t.hi]);
  const bot = niceScale(Math.min(-p.sesoi * 1.6, ...effVals), Math.max(p.sesoi * 1.6, ...effVals), 4);
  const botTicks = bot.ticks;
  const yBot = (v: number) => bTop + H_BOTTOM - ((v - bot.lo) / (bot.hi - bot.lo || 1)) * H_BOTTOM;

  const line = (pts: [number, number][]) => pts.map(([a, b], i) => `${i ? "L" : "M"}${a.toFixed(1)},${b.toFixed(1)}`).join("");
  const treatedPts = p.series.filter((d) => (split ? d.treated : d.value) != null).map((d) => [x(d.day), yTop((split ? d.treated : d.value)!)] as [number, number]);
  const controlPts = split ? p.series.filter((d) => d.control != null).map((d) => [x(d.day), yTop(d.control!)] as [number, number]) : [];
  const band = p.trajectory.length
    ? `${line(p.trajectory.map((t) => [x(t.day), yBot(t.hi)]))}L${p.trajectory
        .slice()
        .reverse()
        .map((t) => `${x(t.day).toFixed(1)},${yBot(t.lo).toFixed(1)}`)
        .join("L")}Z`
    : "";

  const startX = x(p.baselineDays - 0.5);
  const washX = x(p.baselineDays + p.washInDays - 0.5);
  const dayTicks = useMemo(() => {
    const step = lastDay > 35 ? 14 : 7;
    const t: number[] = [];
    for (let d = 0; d <= lastDay; d += step) t.push(d);
    return t;
  }, [lastDay]);

  const lastT = treatedPts.at(-1);
  const lastC = controlPts.at(-1);
  const lastTraj = p.trajectory.at(-1);
  const hoverPoint = hover != null ? p.series.find((d) => d.day === hover) : undefined;
  const hoverTraj = hover != null ? p.trajectory.find((t) => t.day === hover) : undefined;
  const sideName = (s?: string | null) => (s ? `${s[0].toUpperCase()}${s.slice(1)}` : "");

  return (
    <figure className="m-0">
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-sm font-medium text-ink">{p.title}</span>
        <span className="text-xs text-muted">{p.higherIsBetter ? "higher is better" : "lower is better"}</span>
      </figcaption>
      {split && (
        <div className="mb-2 flex gap-4 text-xs text-ink-2" aria-label="Legend">
          <span className="flex items-center gap-1.5"><i className="inline-block h-0.5 w-4 rounded bg-treated" />Treated ({sideName(p.treatedSide)})</span>
          <span className="flex items-center gap-1.5"><i className="inline-block h-0.5 w-4 rounded bg-control" />Untreated</span>
        </div>
      )}
      <div ref={wrapRef} className="relative w-full select-none">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${p.title}: daily values and effect estimate with 95% interval`} className="block">
          {/* ---- top panel ---- */}
          <rect x={x(-0.5)} y={M.t} width={startX - x(-0.5)} height={H_TOP} fill="var(--zone)" />
          {p.washInDays > 0 && <rect x={startX} y={M.t} width={washX - startX} height={H_TOP} fill="var(--zone)" opacity={0.5} />}
          {topTicks.map((t) => (
            <g key={`tt${t}`}>
              <line x1={M.l} x2={W - M.r} y1={yTop(t)} y2={yTop(t)} stroke="var(--line)" strokeWidth={1} />
              <text x={M.l - 6} y={yTop(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--muted)" className="tabular">{t}</text>
            </g>
          ))}
          <text x={x(-0.5) + 6} y={M.t - 7} fontSize={11} fill="var(--muted)">Baseline</text>
          <line x1={startX} x2={startX} y1={M.t - 2} y2={M.t + H_TOP} stroke="var(--ink-2)" strokeWidth={1} />
          <text x={startX + 6} y={M.t - 7} fontSize={11} fill="var(--ink-2)">{split ? `Product on ${p.treatedSide} side` : "Product starts"}</text>
          {p.washInDays > 0 && <text x={washX + 6} y={M.t + 12} fontSize={10} fill="var(--muted)">wash-in ends</text>}

          {controlPts.length > 1 && <path d={line(controlPts)} fill="none" stroke="var(--control)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
          {treatedPts.length > 1 && <path d={line(treatedPts)} fill="none" stroke="var(--treated)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
          {controlPts.map(([a, b], i) => <circle key={`c${i}`} cx={a} cy={b} r={3.5} fill="var(--control)" stroke="var(--surface)" strokeWidth={2} />)}
          {treatedPts.map(([a, b], i) => <circle key={`t${i}`} cx={a} cy={b} r={3.5} fill="var(--treated)" stroke="var(--surface)" strokeWidth={2} />)}

          {/* end labels: text in ink, identity from the key mark beside it */}
          {lastT && (
            <g>
              <line x1={W - M.r + 8} x2={W - M.r + 18} y1={lastT[1]} y2={lastT[1]} stroke="var(--treated)" strokeWidth={2} />
              <text x={W - M.r + 22} y={lastT[1]} dy="0.32em" fontSize={11} fill="var(--ink-2)">{split ? "Treated" : "Daily score"}</text>
            </g>
          )}
          {lastC && lastT && Math.abs(lastC[1] - lastT[1]) > 12 && (
            <g>
              <line x1={W - M.r + 8} x2={W - M.r + 18} y1={lastC[1]} y2={lastC[1]} stroke="var(--control)" strokeWidth={2} />
              <text x={W - M.r + 22} y={lastC[1]} dy="0.32em" fontSize={11} fill="var(--ink-2)">Untreated</text>
            </g>
          )}
          {vals.length === 0 && (
            <text x={(M.l + W - M.r) / 2} y={M.t + H_TOP / 2} textAnchor="middle" fontSize={13} fill="var(--muted)">No analyzed days yet</text>
          )}

          {/* ---- bottom panel: effect so far ---- */}
          <text x={M.l} y={bTop - 12} fontSize={12} fontWeight={500} fill="var(--ink)">Effect so far, with 95% interval</text>
          <text x={W - M.r + 8} y={yBot(bot.hi)} dy="0.9em" fontSize={11} fill="var(--muted)">↑ better</text>
          <rect x={M.l} y={yBot(p.sesoi)} width={W - M.l - M.r} height={yBot(-p.sesoi) - yBot(p.sesoi)} fill="var(--zone)" />
          {botTicks.map((t) => (
            <text key={`bt${t}`} x={M.l - 6} y={yBot(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--muted)" className="tabular">{t > 0 ? `+${t}` : t}</text>
          ))}
          <line x1={M.l} x2={W - M.r} y1={yBot(0)} y2={yBot(0)} stroke="var(--ink-2)" strokeWidth={1} />
          <text x={W - M.r + 8} y={yBot(p.sesoi)} dy="0.9em" fontSize={10} fill="var(--muted)">too small</text>
          <text x={W - M.r + 8} y={yBot(p.sesoi)} dy="2.1em" fontSize={10} fill="var(--muted)">to matter</text>
          <text x={W - M.r + 8} y={yBot(p.sesoi)} dy="3.3em" fontSize={10} fill="var(--muted)" className="tabular">(±{p.sesoi})</text>
          {band && <path d={band} fill="var(--band)" />}
          {p.trajectory.length > 1 && (
            <path d={line(p.trajectory.map((t) => [x(t.day), yBot(t.effect)]))} fill="none" stroke="var(--treated)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          )}
          {lastTraj && <circle cx={x(lastTraj.day)} cy={yBot(lastTraj.effect)} r={4} fill="var(--treated)" stroke="var(--surface)" strokeWidth={2} />}
          {!p.trajectory.length && (
            <text x={(M.l + W - M.r) / 2} y={bTop + H_BOTTOM / 2} textAnchor="middle" fontSize={12} fill="var(--muted)">
              The estimate appears once there are enough treatment days.
            </text>
          )}

          {/* x axis */}
          {dayTicks.map((d) => (
            <text key={`x${d}`} x={x(d)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--muted)" className="tabular">
              {d === 0 ? "Day 0" : d}
            </text>
          ))}

          {/* hover layer */}
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={M.t} y2={bTop + H_BOTTOM} stroke="var(--ink-2)" strokeWidth={1} opacity={0.4} data-export-hide />}
          {Array.from({ length: lastDay + 1 }, (_, d) => (
            <rect
              key={`h${d}`}
              x={x(d - 0.5)}
              y={M.t}
              width={x(d + 0.5) - x(d - 0.5)}
              height={bTop + H_BOTTOM - M.t}
              fill="transparent"
              onPointerEnter={() => setHover(d)}
              onPointerLeave={() => setHover((h) => (h === d ? null : h))}
            />
          ))}
        </svg>
        {hover != null && (hoverPoint || hoverTraj) && (
          <div
            data-export-hide
            className="pointer-events-none absolute top-2 z-10 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-sm"
            style={{ left: Math.min(Math.max(x(hover) + 10, 8), W - 180) }}
          >
            <div className="font-medium text-ink">Day {hover} · {hoverPoint?.phase ?? "treatment"}</div>
            {hoverPoint && split && (
              <>
                <div className="tabular text-ink-2"><i className="mr-1 inline-block h-2 w-2 rounded-full bg-treated" />Treated {hoverPoint.treated?.toFixed(1)} {p.unit}</div>
                <div className="tabular text-ink-2"><i className="mr-1 inline-block h-2 w-2 rounded-full bg-control" />Untreated {hoverPoint.control?.toFixed(1)} {p.unit}</div>
              </>
            )}
            {hoverPoint && !split && <div className="tabular text-ink-2">Score {hoverPoint.value?.toFixed(0)}</div>}
            {hoverTraj && <div className="tabular text-ink-2">Effect {fmt(hoverTraj.effect)} ({fmt(hoverTraj.lo)} to {fmt(hoverTraj.hi)})</div>}
          </div>
        )}
      </div>
      {lastTraj && (
        <p className="mt-1 text-xs text-ink-2 tabular">
          Latest estimate {fmt(lastTraj.effect)} {p.unit}, 95% interval {fmt(lastTraj.lo)} to {fmt(lastTraj.hi)}.
        </p>
      )}
      <details className="mt-2 text-xs text-ink-2" data-export-hide>
        <summary className="cursor-pointer select-none text-muted">Show data table</summary>
        <table className="mt-2 w-full text-left tabular">
          <thead className="text-muted">
            <tr>
              <th className="py-1 font-normal">Day</th>
              <th className="font-normal">Phase</th>
              {split ? (<><th className="font-normal">Treated</th><th className="font-normal">Untreated</th></>) : <th className="font-normal">Score</th>}
            </tr>
          </thead>
          <tbody>
            {p.series.map((d) => (
              <tr key={d.day} className="border-t border-line">
                <td className="py-1">{d.day}</td>
                <td>{d.phase}</td>
                {split ? (<><td>{d.treated?.toFixed(2)}</td><td>{d.control?.toFixed(2)}</td></>) : <td>{d.value?.toFixed(0)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
