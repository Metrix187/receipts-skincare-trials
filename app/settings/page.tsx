import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { UnitBalance } from "@/components/UnitBalance";
import { Card, CardTitle, Skeleton } from "@/components/ui";
import { envStatus } from "@/lib/env";
import { ledgerSummary } from "@/lib/youcam/ledger-prisma";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Status />
      </Suspense>
      <Card>
        <CardTitle>Where the API keys go</CardTitle>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-ink-2">
          <li>
            Put your keys in <code className="font-mono text-ink">.env</code> in the project root (gitignored), or keep them in{" "}
            <code className="font-mono text-ink">youcamkey.env</code> next to the repo and run{" "}
            <code className="font-mono text-ink">npm run setup</code> to import them. Secrets are never printed.
          </li>
          <li>
            <code className="font-mono text-ink">YOUCAM_API_KEY</code> comes from the YouCam API console (API Keys tab).{" "}
            <code className="font-mono text-ink">ANTHROPIC_API_KEY</code> powers the Protocol and Verdict agents; without it they run as deterministic mocks.
          </li>
          <li>
            Real YouCam calls only happen with <code className="font-mono text-ink">MOCK_YOUCAM=0</code>, and stop at{" "}
            <code className="font-mono text-ink">YOUCAM_UNIT_BUDGET</code>. Restart <code className="font-mono text-ink">npm run dev</code> after editing.
          </li>
        </ol>
      </Card>
    </div>
  );
}

async function Status() {
  await connection(); // live ledger, never a build-time snapshot
  const s = envStatus();
  const ledger = await ledgerSummary();
  const rows: [string, string, boolean?][] = [
    ["YouCam mode", s.youcamMode === "mock" ? `Mock (${s.youcamMockReason})` : "Live: real units", s.youcamMode === "live"],
    ["YouCam API key", s.youcamKey],
    ["Analysis tier", `${s.tier.toUpperCase()}: ${s.tier === "sd" ? "9" : "12"} units per daily analysis (1-4 concerns)`],
    ["Unit budget guard", `${s.unitBudget} units`],
    ["Agents", s.agentMode === "mock" ? "Mock (no ANTHROPIC_API_KEY)" : `Live · ${s.model}`, s.agentMode === "live"],
    ["Anthropic API key", s.anthropicKey],
    ["Photo encryption", s.photoEncryption],
    ["Database", s.database],
  ];
  return (
    <>
      <Card>
        <CardTitle>Configuration</CardTitle>
        <dl className="divide-y divide-line text-sm">
          {rows.map(([k, v, on]) => (
            <div key={k} className="flex justify-between gap-4 py-2">
              <dt className="text-muted">{k}</dt>
              <dd className={`text-right ${on ? "font-medium text-good" : "text-ink"}`}>{v}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card>
        <CardTitle>YouCam unit ledger</CardTitle>
        <div className="grid grid-cols-3 gap-3 text-sm tabular">
          <div><div className="text-xs text-muted">Live charged</div><div className="text-lg font-medium">{ledger.live.charged}</div></div>
          <div><div className="text-xs text-muted">Live in flight</div><div className="text-lg font-medium">{ledger.live.reserved}</div></div>
          <div><div className="text-xs text-muted">Mock tasks</div><div className="text-lg font-medium">{ledger.mock.tasks}</div></div>
        </div>
        <p className="mt-2 text-xs text-muted">Failed analyses ({ledger.live.notCharged} units&apos; worth) were never charged: YouCam bills only successful tasks.</p>
        <div className="mt-3"><UnitBalance live={s.youcamMode === "live"} /></div>
        {ledger.recent.length > 0 && (
          <table className="mt-4 w-full text-left text-xs tabular">
            <thead className="text-muted">
              <tr><th className="py-1 font-normal">When</th><th className="font-normal">Tier</th><th className="font-normal">Concerns</th><th className="font-normal">Units</th><th className="font-normal">Status</th></tr>
            </thead>
            <tbody>
              {ledger.recent.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="py-1">{r.createdAt.toISOString().slice(5, 16).replace("T", " ")}</td>
                  <td>{r.tier.toUpperCase()}</td>
                  <td>{r.concernCount}</td>
                  <td>{r.units}</td>
                  <td>{r.mock ? "mock" : r.status.replace("_", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
