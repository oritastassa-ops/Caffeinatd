import { BadgeTone, badgeClasses, priorityMeta } from "./styles";

/**
 * Small semantic pill. Powers both the task PriorityBadge and the status chips
 * described in docs/03-ux.md (Verified / Pending / Opted-out), so they stop
 * being three hand-rolled variations of the same thing.
 */
export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: React.ReactNode;
}) {
  return <span className={badgeClasses(tone, className)}>{children}</span>;
}

/** Task priority 1–4 as a toned Badge. */
export function PriorityBadge({ priority }: { priority: number }) {
  const { tone, label } = priorityMeta(priority);
  return <Badge tone={tone}>{label}</Badge>;
}
