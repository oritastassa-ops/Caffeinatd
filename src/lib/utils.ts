/** Date helpers — all planning math runs in the user's timezone. */

export function nowInTz(timezone: string): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: timezone }));
}

/** YYYY-MM-DD for "today" in the user's timezone. */
export function localDateStr(timezone: string, d = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: timezone });
}

export function formatTime(iso: string, timezone: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDay(iso: string, timezone: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function startOfDayISO(dateStr: string, timezone: string): string {
  return zonedTimeToUtc(dateStr, "00:00", timezone).toISOString();
}

export function endOfDayISO(dateStr: string, timezone: string): string {
  return zonedTimeToUtc(dateStr, "23:59", timezone).toISOString();
}

/**
 * Convert a local wall-clock time in a timezone to a UTC Date without a tz
 * library: compute the zone's offset at that instant and correct for it.
 */
export function zonedTimeToUtc(dateStr: string, timeStr: string, timezone: string): Date {
  const naive = new Date(`${dateStr}T${timeStr}:00Z`);
  const offsetMs = tzOffsetMs(naive, timezone);
  return new Date(naive.getTime() - offsetMs);
}

function tzOffsetMs(at: Date, timezone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(dtf.formatToParts(at).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour === "24" ? "0" : parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - at.getTime();
}

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

/** "2 minutes ago", "3 hours ago", "5 days ago" — used for integration sync status. */
export function relativeTime(iso: string, now = Date.now()): string {
  const diffMs = now - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
