import { Card } from "@/components/ui";
import { PixelAvatar } from "@/components/avatars/pixel-avatar";
import { CommunicationStyle } from "@/lib/types";

export interface BriefStat {
  label: string;
  value: string;
}

/**
 * The dashboard hero — date, greeting, the assistant's one-line overview, and
 * four at-a-glance stats. The single "speaks first" moment (docs/03-ux.md), so
 * it leads the page and carries the accent-tinted surface.
 */
export function MorningBrief({
  dateStr,
  greeting,
  emoji,
  displayName,
  personality,
  overview,
  stats,
}: {
  dateStr: string;
  greeting: string;
  emoji: string;
  displayName: string;
  personality: CommunicationStyle;
  overview: string;
  stats: BriefStat[];
}) {
  return (
    <Card className="card-enter border-accent/25 bg-gradient-to-br from-accent-soft/60 to-surface">
      <p className="text-xs font-medium uppercase tracking-wider text-text-dim">{dateStr}</p>
      <div className="mt-1 flex items-center gap-3">
        <PixelAvatar personality={personality} size={40} mode="idle" />
        <h1 className="text-title font-semibold tracking-tight">
          {greeting}, {displayName} {emoji}
        </h1>
      </div>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-dim">{overview}</p>
      <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label}>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-text-dim">{s.label}</p>
            <p className="mt-0.5 truncate text-sm font-medium" title={s.value}>
              {s.value}
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}
