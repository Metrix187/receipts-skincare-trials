"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { btn } from "@/components/ui";

export function ClaudeKeyDialog() {
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      const response = await fetch("/api/settings/claude-key", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: key.trim() }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save key.");
      setKey(""); dialog.current?.close(); router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save key."); }
    finally { setBusy(false); }
  }
  return <>
    <button className={btn.secondary} onClick={() => dialog.current?.showModal()}>Set Claude API key</button>
    <dialog ref={dialog} onClose={() => { setKey(""); setError(""); }} className="m-auto w-[min(92vw,32rem)] rounded-2xl border border-line bg-surface p-6 text-ink shadow-xl backdrop:bg-black/60">
      <form onSubmit={save} className="space-y-4">
        <h2 className="text-lg font-semibold">Connect Claude</h2>
        <p className="text-sm text-ink-2">Paste your Anthropic API key. It is saved in your local, gitignored .env.local file. Live agent calls use your Anthropic account and may incur charges.</p>
        <label className="block text-sm font-medium" htmlFor="claude-key">Anthropic API key</label>
        <input id="claude-key" type="password" autoComplete="off" required value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-ink" />
        {error && <p role="alert" className="text-sm text-crit">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" className={btn.secondary} onClick={() => dialog.current?.close()}>Cancel</button><button disabled={busy} className={btn.primary}>{busy ? "Saving…" : "Save key"}</button></div>
      </form>
    </dialog>
  </>;
}
