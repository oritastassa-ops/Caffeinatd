import { cn } from "@/lib/utils";
import { CommunicationStyle } from "@/lib/types";
import { PixelAvatar } from "./avatars/pixel-avatar";

export function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border bg-surface p-5", className)}>{children}</section>
  );
}

export function CardTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-dim">
      {children}
    </h2>
  );
}

const PRIORITY_STYLES: Record<number, string> = {
  1: "bg-bad/10 text-bad",
  2: "bg-accent-soft text-accent",
  3: "bg-surface-2 text-text-dim",
  4: "bg-surface-2 text-text-dim",
};

export function PriorityBadge({ priority }: { priority: number }) {
  const label = ["", "Urgent", "High", "Normal", "Low"][priority] ?? "Normal";
  return (
    <span
      className={cn(
        "rounded-md px-1.5 py-0.5 text-[11px] font-medium",
        PRIORITY_STYLES[priority] ?? PRIORITY_STYLES[3],
      )}
    >
      {label}
    </span>
  );
}

/**
 * Empty states are hosted by a cast member when `character` is set —
 * deliberately domain-mapped (Maggie greets an empty workout list, Jimmy an
 * empty shopping list…) rather than selection-mapped, so the whole cast stays
 * visible no matter which personality the user talks to. Falls back to the
 * coffee-cup mark when no host is assigned.
 */
export function EmptyState({
  title,
  hint,
  character,
}: {
  title?: string;
  hint: string;
  character?: CommunicationStyle;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      {character ? (
        <PixelAvatar personality={character} size={48} mode="idle" />
      ) : (
        <svg viewBox="0 0 32 32" className="h-7 w-7 text-bean" fill="none" aria-hidden>
          <path className="steam" d="M12 8 C 10 6, 14 5, 12 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          <path className="steam steam-2" d="M16 8 C 14 6, 18 5, 16 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          <path className="steam steam-3" d="M20 8 C 18 6, 22 5, 20 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          <path d="M7 12 h16 v6 a6 6 0 0 1 -6 6 h-4 a6 6 0 0 1 -6 -6 z" fill="currentColor" opacity="0.9" />
          <path d="M23 13 h2.5 a3 3 0 0 1 0 6 H23" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      )}
      {title && <p className="text-sm font-medium">{title}</p>}
      <p className="max-w-xs text-sm text-text-dim">{hint}</p>
    </div>
  );
}
