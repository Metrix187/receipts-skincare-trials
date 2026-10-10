import type { Metadata } from "next";
import { NewTrialForm } from "./NewTrialForm";

export const metadata: Metadata = { title: "New trial" };

export default function NewTrialPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New trial</h1>
        <p className="mt-1 text-sm text-ink-2">
          Tell us what you&apos;re testing and what it promises. The Protocol Agent designs the experiment; you
          review it before anything is locked.
        </p>
      </div>
      <NewTrialForm />
    </div>
  );
}
