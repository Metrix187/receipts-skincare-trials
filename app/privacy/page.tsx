import type { Metadata } from "next";
import { Card } from "@/components/ui";

export const metadata: Metadata = { title: "Privacy" };

const ITEMS: [string, string][] = [
  ["What leaves your device", "Only the cropped face photo, and only to YouCam (Perfect Corp) for AI Skin Analysis. Face detection and the lighting/pose checks run in your browser; the detector model is served from this site, not a CDN."],
  ["What the AI agents see", "The Protocol and Verdict agents (Anthropic API) receive your product name, the claim, and numbers: daily scores and statistics. Never photos."],
  ["How photos are stored", "Encrypted at rest with AES-256-GCM, each bound to its capture record. The key lives in the server's environment, not the database."],
  ["Deleting", "“Delete all photos” on a trial wipes every stored selfie in one click; scores remain so the verdict still works. “Delete trial” removes everything: photos, scores, agent logs and verdicts. YouCam keeps processed results for up to 24 hours per their retention policy."],
  ["Accounts", "None. Your browser gets an anonymous id cookie, and trials are visible only to that browser. Receipts are shared by unguessable link and contain no photos."],
  ["Not medical advice", "AI-estimated skin scores of one person. Talk to a dermatologist about skin concerns."],
];

export default function PrivacyPage() {
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">Privacy</h1>
      <Card>
        <dl className="space-y-4 text-sm">
          {ITEMS.map(([k, v]) => (
            <div key={k}>
              <dt className="font-medium text-ink">{k}</dt>
              <dd className="mt-0.5 text-ink-2">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
