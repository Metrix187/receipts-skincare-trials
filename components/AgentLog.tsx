import type { AgentRun } from "@prisma/client";
import type { TranscriptEntry } from "@/lib/agents/runner";

const TOOL_LABEL: Record<string, string> = {
  list_skin_metrics: "Looked up what YouCam can measure",
  estimate_trial_cost: "Estimated YouCam units",
  assign_treated_side: "Randomized the treated side",
  check_protocol: "Checked the draft against the design rules",
  submit_protocol: "Submitted the protocol",
  get_protocol: "Read the locked protocol",
  check_data_quality: "Checked data quality",
  run_preregistered_analysis: "Ran the pre-registered analysis",
  get_daily_series: "Read the daily series",
  describe_secondary: "Described a secondary concern (not tested)",
  submit_verdict: "Submitted the verdict",
};

function Json({ value }: { value: unknown }) {
  return (
    <pre className="mt-1 max-h-64 overflow-auto rounded-lg bg-surface-2 p-2 font-mono text-[11px] leading-relaxed text-ink-2">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

/** "How the agent reasoned": the full logged transcript of one agent run. */
export function AgentLog({ run }: { run: AgentRun }) {
  const entries = (run.transcript as unknown as TranscriptEntry[]) ?? [];
  const results = new Map(entries.filter((e) => e.kind === "tool_result").map((e) => [(e as Extract<TranscriptEntry, { kind: "tool_result" }>).id, e]));
  return (
    <details className="group rounded-xl border border-line">
      <summary className="flex cursor-pointer select-none items-center justify-between gap-2 px-3 py-2 text-sm">
        <span className="font-medium text-ink">
          {run.agent === "protocol" ? "Protocol Agent" : "Verdict Agent"}: how it reasoned
        </span>
        <span className="text-xs text-muted tabular">
          {run.mock ? "mock" : run.model} · {(run.durationMs / 1000).toFixed(1)}s
          {run.status !== "ok" && <span className="ml-1 text-warn">· {run.status}</span>}
        </span>
      </summary>
      <ol className="space-y-2 border-t border-line px-3 py-3 text-sm">
        {entries.map((e, i) => {
          if (e.kind === "tool_result") return null;
          if (e.kind === "user") return <li key={i} className="text-xs text-muted">Task given to the agent{i === 0 ? "" : " (follow-up)"}: <span className="whitespace-pre-wrap">{e.text.length > 400 ? `${e.text.slice(0, 400)}…` : e.text}</span></li>;
          if (e.kind === "note") return <li key={i} className="text-xs italic text-muted">{e.text}</li>;
          if (e.kind === "thinking") return <li key={i} className="border-l-2 border-line pl-3 text-xs italic text-ink-2 whitespace-pre-wrap">{e.text}</li>;
          if (e.kind === "text") return <li key={i} className="text-ink whitespace-pre-wrap">{e.text}</li>;
          const res = results.get(e.id) as Extract<TranscriptEntry, { kind: "tool_result" }> | undefined;
          return (
            <li key={i}>
              <details>
                <summary className="cursor-pointer select-none text-ink-2">
                  <span className="font-mono text-xs text-muted">{e.name}</span> · {TOOL_LABEL[e.name] ?? e.name}
                  {res?.isError && <span className="ml-1 text-crit">· rejected, agent retried</span>}
                </summary>
                <div className="mt-1 grid gap-1 pl-2">
                  <div className="text-[11px] uppercase tracking-wide text-muted">input</div>
                  <Json value={e.input} />
                  {res && (
                    <>
                      <div className="text-[11px] uppercase tracking-wide text-muted">result</div>
                      <Json value={res.output} />
                    </>
                  )}
                </div>
              </details>
            </li>
          );
        })}
        {run.error && <li className="text-xs text-crit">Error: {run.error}</li>}
        {(run.inputTokens ?? 0) > 0 && (
          <li className="text-[11px] text-muted tabular">{run.inputTokens} input / {run.outputTokens} output tokens</li>
        )}
      </ol>
    </details>
  );
}
