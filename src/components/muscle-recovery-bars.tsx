import { MuscleRecovery } from "@/lib/fitness/recovery";
import { cn } from "@/lib/utils";

export function MuscleRecoveryBars({ recoveries }: { recoveries: MuscleRecovery[] }) {
  if (recoveries.length === 0) {
    return <p className="text-sm text-text-dim">Log a few workouts to see recovery by muscle group.</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {recoveries.map((r) => (
        <li key={r.group}>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="capitalize">{r.group}</span>
            <span
              className={cn(
                "text-xs font-medium",
                r.label === "Fatigued" ? "text-bad" : r.label === "Recovering" ? "text-accent" : "text-good",
              )}
            >
              {r.label} · {r.percent}%
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className={cn(
                "h-full rounded-full transition-fast",
                r.label === "Fatigued" ? "bg-bad" : r.label === "Recovering" ? "bg-accent" : "bg-good",
              )}
              style={{ width: `${r.percent}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-text-dim">{r.detail}</p>
        </li>
      ))}
    </ul>
  );
}
