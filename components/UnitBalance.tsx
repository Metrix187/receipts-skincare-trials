"use client";

import { useState } from "react";
import { btn } from "./ui";

/** Asks YouCam for the real unit balance (GET /s2s/v1.0/client/credit, a free call). */
export function UnitBalance({ live }: { live: boolean }) {
  const [balance, setBalance] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!live) return <p className="text-xs text-muted">Live balance check is available when MOCK_YOUCAM=0.</p>;
  async function check() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/units?live=1");
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      setBalance(b.balance);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex items-center gap-3 text-sm">
      <button type="button" className={btn.secondary} onClick={check} disabled={busy}>{busy ? "Checking…" : "Check YouCam balance (free)"}</button>
      {balance != null && <span className="tabular">{balance} units left</span>}
      {error && <span className="text-crit">{error}</span>}
    </div>
  );
}
