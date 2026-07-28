import { cn, formatTime } from "@/lib/utils";
import { TimelineItem } from "@/lib/dashboard/today";

export type { TimelineItem };

/**
 * The day as a single vertical thread — calendar events and planned work
 * blocks interleaved chronologically. Past items recede; the next one leads.
 */
export function Timeline({ items, tz }: { items: TimelineItem[]; tz: string }) {
  const allDay = items.filter((i) => i.allDay);
  const timed = items
    .filter((i) => !i.allDay)
    .sort((a, b) => a.start.localeCompare(b.start));
  const now = new Date().toISOString();
  const nextIdx = timed.findIndex((i) => (i.end ?? i.start) >= now);

  if (items.length === 0) {
    return <p className="text-sm text-text-dim">A completely open day. Protect it or plan it.</p>;
  }

  return (
    <div className="flex flex-col gap-1">
      {allDay.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {allDay.map((i, idx) => (
            <span key={idx} className="rounded-lg border bg-surface-2 px-2 py-0.5 text-xs">
              {i.title}
            </span>
          ))}
        </div>
      )}
      <ol className="relative flex flex-col">
        {timed.map((item, idx) => {
          const past = nextIdx === -1 || idx < nextIdx;
          const current = idx === nextIdx;
          return (
            <li key={idx} className="relative flex gap-3 pb-3 last:pb-0">
              {/* rail */}
              <span aria-hidden className="relative flex w-3 shrink-0 justify-center">
                {idx < timed.length - 1 && (
                  <span className="absolute top-2 h-full w-px bg-border" />
                )}
                <span
                  className={cn(
                    "relative z-10 mt-1.5 h-2 w-2 rounded-full",
                    current ? "bg-accent ring-4 ring-accent/15" : past ? "bg-border" : "bg-bean/50",
                  )}
                />
              </span>
              <div className={cn("min-w-0 flex-1", past && "opacity-55")}>
                <div className="flex items-baseline gap-2">
                  <span className="tabular shrink-0 text-xs text-text-dim">
                    {formatTime(item.start, tz)}
                    {item.end && ` – ${formatTime(item.end, tz)}`}
                  </span>
                  {item.kind === "block" && (
                    <span className="rounded bg-accent-soft px-1 text-[10px] font-medium uppercase tracking-wide text-accent">
                      plan
                    </span>
                  )}
                </div>
                <p className={cn("truncate text-sm", current && "font-medium")}>{item.title}</p>
                {item.sub && <p className="truncate text-xs text-text-dim">{item.sub}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
