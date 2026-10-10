"use client";

import { useState } from "react";
import { btn } from "./ui";

/** Export the #receipt card as a PNG (2x), and copy the share link. */
export function ReceiptActions({ fileName }: { fileName: string }) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function exportPng() {
    const node = document.getElementById("receipt");
    if (!node) return;
    setBusy(true);
    setError(null);
    try {
      const { toPng } = await import("html-to-image");
      const bg = getComputedStyle(document.body).getPropertyValue("--surface").trim() || "#fcfcfb";
      const url = await toPng(node, {
        pixelRatio: 2,
        backgroundColor: bg,
        // hover crosshair, tooltip and the data table stay out of the image
        filter: (el) => !(el instanceof Element && el.hasAttribute("data-export-hide")),
      });
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
    } catch (e) {
      setError(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Couldn't copy. Copy the address bar instead.");
    }
  }

  return (
    <div className="flex flex-wrap justify-center gap-3">
      <button type="button" className={btn.primary} onClick={exportPng} disabled={busy} data-testid="export-png">
        {busy ? "Rendering…" : "Download PNG"}
      </button>
      <button type="button" className={btn.secondary} onClick={copy}>
        {copied ? "Link copied" : "Copy link"}
      </button>
      {error && <p className="w-full text-center text-sm text-crit">{error}</p>}
    </div>
  );
}
