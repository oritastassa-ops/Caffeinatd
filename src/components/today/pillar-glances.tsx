import Link from "next/link";
import { cn } from "@/lib/utils";

export interface PillarGlance {
  href: string;
  title: string;
  headline: string;
  sub: string;
  accent?: boolean;
}

/**
 * The cross-pillar scan: one tile per domain with its headline number and a
 * jump into the pillar. A navigational link-tile (not a Button), styled on the
 * design tokens.
 */
export function PillarGlances({ glances }: { glances: PillarGlance[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {glances.map((g) => (
        <Link
          key={g.title}
          href={g.href}
          className="transition-fast group rounded-card border bg-surface p-4 hover:border-accent"
        >
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-dim">{g.title}</p>
          <p
            className={cn("mt-1 truncate text-lg font-semibold", g.accent && "text-good")}
            title={g.headline}
          >
            {g.headline}
          </p>
          <p className="truncate text-xs text-text-dim">{g.sub}</p>
        </Link>
      ))}
    </div>
  );
}
