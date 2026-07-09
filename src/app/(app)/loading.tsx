/**
 * Route-level skeleton: every page in the app group is force-dynamic, so
 * navigation waits on the server. This paints instantly instead of freezing
 * the old page while the next one renders.
 */
export default function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-4" aria-label="Loading" role="status">
      <div className="h-8 w-48 rounded-lg bg-surface-2" />
      <div className="h-36 rounded-2xl border bg-surface" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl border bg-surface" />
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="h-48 rounded-2xl border bg-surface" />
        <div className="h-48 rounded-2xl border bg-surface" />
      </div>
    </div>
  );
}
