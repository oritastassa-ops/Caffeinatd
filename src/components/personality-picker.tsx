"use client";

import { useState } from "react";
import { CommunicationStyle } from "@/lib/types";
import { PERSONALITY_LIST } from "@/lib/personalities";
import { PixelAvatar } from "./avatars/pixel-avatar";
import { cn } from "@/lib/utils";

/**
 * Personality cards for the Settings form. Renders a hidden input named
 * `communicationStyle` so the existing updateProfile server action persists
 * the choice unchanged — every assistant surface updates on the next render.
 */
export function PersonalityPicker({ defaultValue }: { defaultValue: CommunicationStyle }) {
  const [selected, setSelected] = useState<CommunicationStyle>(defaultValue);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="communicationStyle" value={selected} />
      {PERSONALITY_LIST.map((p) => {
        const active = p.id === selected;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => setSelected(p.id)}
            aria-pressed={active}
            className={cn(
              "relative rounded-xl border p-4 text-left transition-all duration-200 ease-out",
              active
                ? "scale-[1.02] border-accent bg-accent-soft/50 shadow-[0_0_16px_rgba(217,119,6,0.25)]"
                : "hover:border-accent/50 hover:bg-surface-2",
            )}
          >
            {active && (
              <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[11px] text-white">
                ✓
              </span>
            )}
            <div className="flex items-start gap-3">
              <PixelAvatar
                personality={p.id}
                size={active ? 52 : 48}
                mode={active ? "idle" : "static"}
                className="transition-all duration-200"
              />
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  {p.name} <span className="font-normal text-text-dim">· {p.label}</span>
                </p>
                <p className="mt-0.5 text-xs text-text-dim">{p.tagline}</p>
              </div>
            </div>
            <p className="mt-3 rounded-lg bg-surface px-3 py-2 text-xs italic leading-relaxed text-text-dim">
              &ldquo;{p.sample}&rdquo;
            </p>
          </button>
        );
      })}
    </div>
  );
}
