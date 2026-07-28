"use client";

import { useRef } from "react";
import { cx } from "./cx";
import { ButtonSize, nextSegmentIndex } from "./styles";

const SIZES: Record<ButtonSize, string> = {
  sm: "px-2.5 py-0.5 text-xs",
  md: "px-3 py-1 text-sm",
};

/**
 * View switcher (calendar day/week, trend ranges). A proper radiogroup: exactly
 * one tab stop (roving tabindex), arrow/Home/End move selection, aria-checked
 * reflects state. Keyboard logic is nextSegmentIndex, unit-tested separately.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = "md",
  className,
}: {
  options: { value: T; label: React.ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  size?: ButtonSize;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  // Fall back to the first tab so the group is always keyboard-reachable, even
  // if `value` matches nothing.
  const activeIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  function handleKeyDown(e: React.KeyboardEvent) {
    const next = nextSegmentIndex(activeIndex, e.key, options.length);
    if (next === null) return;
    const target = options[next];
    if (!target) return;
    e.preventDefault();
    onChange(target.value);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cx("inline-flex gap-1 rounded-pill border bg-surface-2 p-1", className)}
    >
      {options.map((o, i) => {
        const selected = i === activeIndex;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={handleKeyDown}
            className={cx(
              "transition-fast rounded-pill font-medium",
              SIZES[size],
              selected ? "bg-surface text-text" : "text-text-dim hover:text-text",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
