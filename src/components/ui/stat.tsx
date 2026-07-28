import { cx } from "./cx";
import { Card } from "./card";

/**
 * A single metric tile: label, big tabular value, optional sub-line and delta.
 * Finance, fitness and nutrition each rendered metrics differently before this.
 * `children` is a slot for a sparkline/chart later — deliberately untyped, since
 * charts are out of scope for now.
 */
export function Stat({
  label,
  value,
  sub,
  delta,
  tone = "default",
  children,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  delta?: { label: string; tone?: "good" | "bad" };
  tone?: "default" | "good" | "bad";
  children?: React.ReactNode;
}) {
  return (
    <Card className="p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-text-dim">{label}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <p
          className={cx(
            "tabular text-xl font-semibold",
            tone === "bad" && "text-bad",
            tone === "good" && "text-good",
          )}
        >
          {value}
        </p>
        {delta && (
          <span
            className={cx(
              "tabular text-xs font-medium",
              delta.tone === "bad" ? "text-bad" : delta.tone === "good" ? "text-good" : "text-text-dim",
            )}
          >
            {delta.label}
          </span>
        )}
      </div>
      {sub && <p className="text-xs text-text-dim">{sub}</p>}
      {children}
    </Card>
  );
}
