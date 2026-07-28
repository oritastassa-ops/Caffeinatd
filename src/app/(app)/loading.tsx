import { Skeleton } from "@/components/ui";

/**
 * Route-level skeleton: every page in the app group is force-dynamic, so
 * navigation waits on the server. This paints the dashboard's shape — hero,
 * glance row, two-column body — instead of freezing the old page. Routes with a
 * very different layout ship their own loading.tsx (e.g. calendar).
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-label="Loading" role="status">
      <Skeleton className="h-36 rounded-card" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-card" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Skeleton className="h-56 rounded-card" />
          <Skeleton className="h-40 rounded-card" />
        </div>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-32 rounded-card" />
          <Skeleton className="h-40 rounded-card" />
        </div>
      </div>
    </div>
  );
}
