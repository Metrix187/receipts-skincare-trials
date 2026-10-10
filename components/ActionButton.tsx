"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { btn } from "./ui";

/** Calls a JSON endpoint, then refreshes or navigates. Shows the server's error text. */
export function ActionButton(props: {
  endpoint: string;
  method?: "POST" | "DELETE";
  children: ReactNode;
  busy?: ReactNode;
  confirm?: string;
  redirectTo?: string;
  variant?: keyof typeof btn;
  className?: string;
  testId?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (props.confirm && !window.confirm(props.confirm)) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(props.endpoint, { method: props.method ?? "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      if (props.redirectTo) router.push(props.redirectTo);
      else router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={props.className}>
      <button type="button" onClick={run} disabled={pending} className={btn[props.variant ?? "primary"]} data-testid={props.testId}>
        {pending ? (props.busy ?? "Working…") : props.children}
      </button>
      {error && <p className="mt-2 text-sm text-crit" role="alert">{error}</p>}
    </div>
  );
}
