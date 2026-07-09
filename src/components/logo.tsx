/**
 * Caffeinatd mark: a coffee bean (the seam cut out as negative space) with a
 * four-point AI spark. Single-color via currentColor for the bean; the spark
 * uses the latte-orange accent. Reads cleanly down to favicon size.
 */
export function LogoMark({ className, uid = "logo" }: { className?: string; uid?: string }) {
  const maskId = `bean-seam-${uid}`;
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" aria-hidden>
      <defs>
        <mask id={maskId}>
          <rect width="32" height="32" fill="white" />
          {/* the S-curve seam, removed from the bean so the background shows through */}
          <path
            d="M16 6.5 C 12.6 11.5, 19.4 20.5, 16 25.5"
            stroke="black"
            strokeWidth="2.4"
            fill="none"
            strokeLinecap="round"
          />
        </mask>
      </defs>
      <g transform="rotate(-18 16 16)">
        <ellipse cx="16" cy="16" rx="7.6" ry="10.6" fill="currentColor" mask={`url(#${maskId})`} />
      </g>
      {/* AI spark */}
      <path
        d="M25 3.5 l0.95 2.75 l2.75 0.95 l-2.75 0.95 l-0.95 2.75 l-0.95 -2.75 l-2.75 -0.95 l2.75 -0.95 Z"
        fill="var(--accent)"
      />
    </svg>
  );
}

export function Wordmark({ className, uid }: { className?: string; uid?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <LogoMark className="h-[18px] w-[18px] text-bean" uid={uid} />
      <span className="text-sm font-semibold tracking-tight">Caffeinatd</span>
    </span>
  );
}
