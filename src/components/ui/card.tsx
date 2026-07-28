import { cx } from "./cx";

/** A boxed, border-only surface. The default container for grouped content. */
export function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("rounded-card border bg-surface p-5", className)}>{children}</section>
  );
}

/** The label heading inside a Card. Also the model for Section's title. */
export function CardTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-dim">
      {children}
    </h2>
  );
}
