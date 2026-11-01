import type { Metadata } from "next";
import { Card } from "@/components/ui";

export const metadata: Metadata = { title: "Privacy" };

const ITEMS: [string, string][] = [
  ["What leaves your device", "The cropped photo goes to the Receipts server and YouCam (Perfect Corp) for analysis. Product details and numerical measurements may also go to Anthropic for the agents; photos do not. Face detection and quality checks run in your browser."],
  ["What the AI agents see", "The Protocol and Verdict agents (Anthropic API) receive your product name, the claim, and numbers: daily scores and statistics. Never photos."],
  ["How photos are stored", "Encrypted at rest with AES-256-GCM, each bound to its capture record. The key lives in the server's environment, not the database."],
  ["Deleting", "“Delete all photos” removes locally stored selfies and saved mask links; scores remain. It cannot delete a file already sent to YouCam. “Delete trial” removes its local scores, photos, agent logs and verdicts. YouCam applies its own retention policy."],
  ["Accounts", "None. A browser cookie separates trials for this prototype, but it is not authenticated account security. Do not use a public deployment for sensitive personal data without adding real authentication. Shared receipts contain no photos."],
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
