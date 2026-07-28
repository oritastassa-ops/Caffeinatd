import { cn } from "@/lib/utils";

/**
 * Pure class-mapping and small state logic for the primitives, kept JSX-free so
 * it is unit-testable in the node test env (the tests glob, no DOM). The
 * components in this folder render; the decisions live here.
 */

// ── Button / LinkButton ──────────────────────────────────────────────────────

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-control font-medium " +
  "transition-fast select-none disabled:pointer-events-none disabled:opacity-50";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  // The one high-emphasis action per view. Accent is reserved for this.
  primary: "bg-accent text-white hover:opacity-90 active:opacity-100",
  // Neutral bordered action — the app's "Connect" / "Manage" treatment.
  secondary: "border bg-surface hover:border-accent hover:bg-surface-2",
  // Low-emphasis; recedes until hovered.
  ghost: "text-text-dim hover:bg-surface-2 hover:text-text",
  // Destructive. The app has no solid-red buttons today; this matches the
  // existing text-bad affordances (Disconnect, Sign out) with a hover wash.
  danger: "text-bad hover:bg-bad/10",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  // Padding-based, never fixed heights — controls must grow with text size.
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2.5 text-sm",
};

export function buttonClasses(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
): string {
  return cn(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className);
}

/**
 * Loading implies disabled and takes precedence: a loading button is never
 * clickable regardless of the `disabled` prop, and always reports aria-busy.
 */
export function buttonState({
  disabled,
  loading,
}: {
  disabled?: boolean;
  loading?: boolean;
}): { disabled: boolean; ariaBusy: boolean } {
  return { disabled: Boolean(disabled || loading), ariaBusy: Boolean(loading) };
}

// ── Inputs ───────────────────────────────────────────────────────────────────

export function controlClasses(hasError?: boolean, className?: string): string {
  return cn(
    // py matches Button size md so an input and a button line up in a row.
    "w-full rounded-control border bg-surface-2 px-3 py-2.5 text-sm outline-none",
    "transition-fast placeholder:text-text-dim focus:border-accent",
    hasError && "border-bad focus:border-bad",
    className,
  );
}

/**
 * Derives the aria-describedby target id and the id used for the hint/error
 * node from a control's own id, so a hint is announced without a hook (keeps
 * inputs usable inside server components). Returns null when there's no
 * describing text to point at.
 */
export function describedBy(
  id: string | undefined,
  hasHint: boolean,
  hasError: boolean,
): { describedById: string | undefined; messageId: string | undefined } {
  if (!id || (!hasHint && !hasError)) {
    return { describedById: undefined, messageId: undefined };
  }
  const messageId = `${id}-msg`;
  return { describedById: messageId, messageId };
}

// ── Badge ────────────────────────────────────────────────────────────────────

export type BadgeTone = "neutral" | "accent" | "good" | "bad";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-text-dim",
  accent: "bg-accent-soft text-accent",
  good: "bg-good/10 text-good",
  bad: "bg-bad/10 text-bad",
};

export function badgeClasses(tone: BadgeTone = "neutral", className?: string): string {
  return cn(
    "inline-flex items-center rounded-pill px-1.5 py-0.5 text-[11px] font-medium",
    BADGE_TONES[tone],
    className,
  );
}

/** Priority 1–4 → the badge tone and human label. 1 is most urgent. */
export function priorityMeta(priority: number): { tone: BadgeTone; label: string } {
  const label = ["", "Urgent", "High", "Normal", "Low"][priority] ?? "Normal";
  const tone: BadgeTone = priority === 1 ? "bad" : priority === 2 ? "accent" : "neutral";
  return { tone, label };
}

// ── SegmentedControl roving-focus logic ──────────────────────────────────────

/**
 * Given the focused index and an arrow/Home/End key, return the next index to
 * focus (wrapping). Returns null for keys that don't move focus, so the caller
 * knows not to preventDefault. Pure so the keyboard contract can be tested
 * without a DOM.
 */
export function nextSegmentIndex(current: number, key: string, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (current + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
