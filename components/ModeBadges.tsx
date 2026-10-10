import { env } from "@/lib/env";

/** Always-visible reminder of what's real: mock YouCam data must never pass as real. */
export function ModeBadges() {
  const e = env();
  if (!e.youcamMock && !e.agentsMock) return null;
  const title = [e.youcamMock && "MOCK_YOUCAM: results are fixtures, no units spent", e.agentsMock && "No ANTHROPIC_API_KEY: deterministic agents"].filter(Boolean).join(" · ");
  return (
    <div className="flex gap-1 whitespace-nowrap text-[11px] font-medium" title={title}>
      {/* phones: one compact badge */}
      <span className="rounded-full bg-warn-bg px-2 py-0.5 text-warn sm:hidden">Mock</span>
      {e.youcamMock && <span className="hidden rounded-full bg-warn-bg px-2 py-0.5 text-warn sm:inline">Mock YouCam</span>}
      {e.agentsMock && <span className="hidden rounded-full bg-neutral-bg px-2 py-0.5 text-ink-2 sm:inline">Mock agents</span>}
    </div>
  );
}
