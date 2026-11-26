"use client";

import { useEffect, useState } from "react";
import { COMMAND_EVENT, STATE_EVENT, type ChickenCommand, type ChickenStatus } from "./field/engine";

/**
 * The one way to switch the chicken off, bring it back, or (with reduced motion) call it, from
 * the keyboard or a screen reader. The chicken itself is decoration; nothing depends on it. It
 * talks to the engine over two window events, so neither imports the other's state, and it
 * remembers the choice in this browser.
 */
export function ChickenToggle({ className }: { className?: string }) {
  const [status, setStatus] = useState<Pick<ChickenStatus, "enabled" | "visible" | "reduced"> | null>(null);

  useEffect(() => {
    const onState = (e: Event) => setStatus((e as CustomEvent<ChickenStatus>).detail);
    window.addEventListener(STATE_EVENT, onState);
    // The engine loads after the page and says where it is when it starts; if it is already running, ask it.
    window.dispatchEvent(new CustomEvent<ChickenCommand>(COMMAND_EVENT, { detail: "status" }));
    return () => window.removeEventListener(STATE_EVENT, onState);
  }, []);

  if (!status) return null;
  const { enabled, visible, reduced } = status;
  const label = !enabled ? "Bring the chicken back" : reduced && !visible ? "Call the chicken" : "Hide the chicken";
  const command: ChickenCommand = !enabled ? "show" : reduced && !visible ? "call" : "hide";

  return (
    <button
      type="button"
      className={className}
      onClick={() => window.dispatchEvent(new CustomEvent<ChickenCommand>(COMMAND_EVENT, { detail: command }))}
    >
      {label}
    </button>
  );
}
