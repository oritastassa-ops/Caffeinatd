import { cx } from "./cx";

/**
 * A pulsing placeholder block. Compose several to sketch a loading surface in
 * a loading.tsx. Size it with `className` (height/width utilities); the pulse
 * stops under prefers-reduced-motion.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cx(
        "animate-pulse rounded-control bg-surface-2 motion-reduce:animate-none",
        className,
      )}
      aria-hidden
    />
  );
}
