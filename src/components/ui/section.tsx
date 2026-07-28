import { cx } from "./cx";

/**
 * An UN-boxed titled group — the counterpart to Card. Use it to put a heading
 * over a run of cards or a grid (where a border would be one box too many);
 * use Card when the content wants its own bordered surface. The gap is the
 * app's standard vertical rhythm so sibling sections line up.
 */
export function Section({
  title,
  action,
  className,
  children,
}: {
  title?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cx("flex flex-col gap-3", className)}>
      {(title || action) && (
        <div className="flex items-center justify-between">
          {title && (
            <h2 className="text-xs font-semibold uppercase tracking-wider text-text-dim">{title}</h2>
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
