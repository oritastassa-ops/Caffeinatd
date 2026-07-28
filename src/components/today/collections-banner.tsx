import Link from "next/link";

export interface CollectionStatus {
  type: string;
  label: string;
  date: string;
}

/** Bin/collection days due today or tonight — a time-sensitive nudge up top. */
export function CollectionsBanner({ collections }: { collections: CollectionStatus[] }) {
  if (collections.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {collections.map((s) => (
        <Link
          key={s.type}
          href="/home"
          className="card-enter transition-fast flex items-center gap-3 rounded-card border border-accent/30 bg-accent-soft px-4 py-2.5 text-sm hover:border-accent"
        >
          <span aria-hidden>🗑</span>
          <span className="flex-1 font-medium">{s.label}</span>
          <span className="tabular text-xs text-text-dim">{s.date.slice(5)}</span>
        </Link>
      ))}
    </div>
  );
}
