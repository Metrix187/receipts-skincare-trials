import Link from "next/link";

export function PrivacyNote({ compact = false }: { compact?: boolean }) {
  return (
    <aside className={`rounded-2xl border border-line bg-surface-2 text-sm text-ink-2 ${compact ? "p-3" : "p-4"}`}>
      <span className="font-medium text-ink">Privacy.</span> Your selfies are encrypted at rest (AES-256-GCM) and
      only ever sent to YouCam for analysis. The agents see numbers, never photos. You can delete every photo
      in one click; scores stay so your verdict still works.{" "}
      <Link href="/privacy" className="underline underline-offset-2">Details</Link>
    </aside>
  );
}
