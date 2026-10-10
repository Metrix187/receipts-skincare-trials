"use client";

import { useEffect, useState } from "react";

type Mode = "system" | "light" | "dark";
const NEXT: Record<Mode, Mode> = { system: "light", light: "dark", dark: "system" };
const LABEL: Record<Mode, string> = { system: "Auto", light: "Light", dark: "Dark" };

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("system");

  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    // Sync from the pre-paint script's choice once mounted.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (t === "light" || t === "dark") setMode(t);
  }, []);

  function cycle() {
    const next = NEXT[mode];
    setMode(next);
    if (next === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
    try {
      if (next === "system") localStorage.removeItem("rcpt-theme");
      else localStorage.setItem("rcpt-theme", next);
    } catch {
      /* storage unavailable: theme still applies for this visit */
    }
  }

  return (
    <button
      type="button"
      onClick={cycle}
      className="rounded-md px-2 py-1 hover:bg-surface-2"
      aria-label={`Theme: ${LABEL[mode]}. Click to change.`}
      title="Theme"
    >
      <span aria-hidden>{mode === "dark" ? "●" : mode === "light" ? "○" : "◐"}</span>
      <span className="ml-1 hidden sm:inline">{LABEL[mode]}</span>
    </button>
  );
}
