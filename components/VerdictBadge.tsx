import type { VerdictLabel } from "@/lib/stats";

// Status color never carries meaning alone: every badge has an icon and a label.
const STYLE: Record<VerdictLabel, { cls: string; icon: string; text: string }> = {
  improved: { cls: "bg-good-bg text-good", icon: "↑", text: "Likely improved" },
  worsened: { cls: "bg-crit-bg text-crit", icon: "↓", text: "Got worse" },
  no_meaningful_change: { cls: "bg-neutral-bg text-ink-2", icon: "=", text: "No meaningful change" },
  inconclusive: { cls: "bg-warn-bg text-warn", icon: "?", text: "Inconclusive" },
  not_enough_data: { cls: "bg-neutral-bg text-ink-2", icon: "…", text: "Not enough data" },
};

export function VerdictBadge({ label, size = "sm", interim = false, experimental = false }: { label: VerdictLabel; size?: "sm" | "lg"; interim?: boolean; experimental?: boolean }) {
  const s = STYLE[label];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-medium ${s.cls} ${size === "lg" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-xs"}`}>
      <span aria-hidden className="font-semibold">{s.icon}</span>
      {interim && label === "inconclusive" ? "Interim" : experimental && label === "improved" ? "Proxy lower" : experimental && label === "worsened" ? "Proxy higher" : s.text}
    </span>
  );
}
