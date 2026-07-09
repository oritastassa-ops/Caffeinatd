/** Coffee-steam loading motif — a cup with three rising wisps. Subtle, on-brand. */
export function Brewing({ label = "Brewing…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-text-dim">
      <svg viewBox="0 0 32 32" className="h-5 w-5" fill="none" aria-hidden>
        {/* steam */}
        <path className="steam" d="M12 8 C 10 6, 14 5, 12 3" stroke="var(--text-dim)" strokeWidth="1.4" strokeLinecap="round" />
        <path className="steam steam-2" d="M16 8 C 14 6, 18 5, 16 3" stroke="var(--text-dim)" strokeWidth="1.4" strokeLinecap="round" />
        <path className="steam steam-3" d="M20 8 C 18 6, 22 5, 20 3" stroke="var(--text-dim)" strokeWidth="1.4" strokeLinecap="round" />
        {/* cup */}
        <path
          d="M7 12 h16 v6 a6 6 0 0 1 -6 6 h-4 a6 6 0 0 1 -6 -6 z"
          fill="var(--accent)"
        />
        <path d="M23 13 h2.5 a3 3 0 0 1 0 6 H23" stroke="var(--accent)" strokeWidth="1.6" fill="none" />
      </svg>
      <span>{label}</span>
    </div>
  );
}
