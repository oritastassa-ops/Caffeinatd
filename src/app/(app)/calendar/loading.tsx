import { PageHeader, Skeleton } from "@/components/ui";

/**
 * Skeleton of the week grid — a header strip, a toolbar row, and a bordered
 * body with a hint of columns — so the calendar loads into its own shape
 * rather than flashing an empty grid that fills in.
 */
export default function CalendarLoading() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Calendar" />

      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-8 w-48" />
      </div>

      <div className="overflow-hidden rounded-card border bg-surface">
        <div className="flex border-b">
          <div className="w-14 shrink-0" />
          <div className="flex flex-1">
            {Array.from({ length: 7 }, (_, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1.5 border-l py-2 first:border-l-0">
                <Skeleton className="h-3 w-8" />
                <Skeleton className="h-5 w-5 rounded-pill" />
              </div>
            ))}
          </div>
        </div>
        <div className="flex">
          <div className="flex w-14 shrink-0 flex-col gap-8 py-4 pr-2">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-3 w-9 self-end" />
            ))}
          </div>
          <div className="flex-1 space-y-8 p-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
