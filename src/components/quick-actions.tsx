"use client";

import { OPEN_COMMAND_BAR_EVENT } from "./command-bar";

const ACTIONS = [
  { label: "Log meal", icon: "◐", preset: "I ate " },
  { label: "Log workout", icon: "⚡", preset: "Logged a workout: " },
  { label: "Add task", icon: "☑", preset: "Remind me to " },
  { label: "Plan day", icon: "◈", preset: "Plan my day" },
  { label: "Ask AI", icon: "✦", preset: "" },
];

/** Opens the command bar pre-filled, rather than acting directly — the user still reviews before sending. */
export function QuickActions() {
  function open(preset: string) {
    window.dispatchEvent(new CustomEvent(OPEN_COMMAND_BAR_EVENT, { detail: preset }));
  }

  return (
    <div className="flex flex-wrap gap-2">
      {ACTIONS.map((a) => (
        <button
          key={a.label}
          onClick={() => open(a.preset)}
          className="transition-fast flex items-center gap-2 rounded-xl border bg-surface px-3.5 py-2 text-sm hover:border-accent hover:text-accent"
        >
          <span aria-hidden>{a.icon}</span>
          {a.label}
        </button>
      ))}
    </div>
  );
}
