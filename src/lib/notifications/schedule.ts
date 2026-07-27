import { localDateStr, zonedTimeToUtc } from "@/lib/utils";
import { SMS_QUIET_FLOOR } from "./limits";
import { NotificationChannelName, NotificationKind } from "./types";

/**
 * Send-window math: pure, no I/O, fully unit-tested — the part most likely to be
 * subtly wrong. All timezone conversion goes through zonedTimeToUtc (src/lib/utils),
 * the same DST-correct converter the planner uses; we never add milliseconds to a
 * UTC timestamp and hope.
 */

/** Kinds that interrupt regardless of quiet hours — defined once, not per call site. */
const URGENT_KINDS: ReadonlySet<NotificationKind> = new Set<NotificationKind>(["system"]);

export function isUrgentKind(kind: NotificationKind): boolean {
  return URGENT_KINDS.has(kind);
}

export interface QuietPrefs {
  /** 'HH:MM' or 'HH:MM:SS' local, or null for none. */
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
}

interface Window {
  startMin: number; // minutes since local midnight
  endMin: number;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

/** Local minutes-since-midnight of an instant, in a timezone. */
function localMinutes(at: Date, timeZone: string): number {
  const hhmm = at.toLocaleTimeString("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false });
  return toMinutes(hhmm);
}

/** Does a (possibly midnight-crossing) window contain this minute-of-day? */
function contains(w: Window, minute: number): boolean {
  if (w.startMin === w.endMin) return false; // empty window
  return w.startMin < w.endMin
    ? minute >= w.startMin && minute < w.endMin
    : minute >= w.startMin || minute < w.endMin; // crosses midnight
}

/**
 * The quiet windows that apply to a send. The user's configured window always
 * applies; for SMS a hard floor (22:00–08:00 local) also applies and cannot be
 * removed — SMS is the one channel that wakes people up. Passing both means a
 * send is deferred if it falls in EITHER, i.e. the union (the more restrictive
 * result), which is exactly "a user may narrow but not remove the floor".
 */
function windowsFor(prefs: QuietPrefs, channel: NotificationChannelName | undefined): Window[] {
  const windows: Window[] = [];
  if (prefs.quietHoursStart && prefs.quietHoursEnd) {
    windows.push({ startMin: toMinutes(prefs.quietHoursStart), endMin: toMinutes(prefs.quietHoursEnd) });
  }
  if (channel === "sms") {
    windows.push({ startMin: SMS_QUIET_FLOOR.startHourLocal * 60, endMin: SMS_QUIET_FLOOR.endHourLocal * 60 });
  }
  return windows;
}

/** The UTC instant of a window's end time, on or after `at`, in the local zone. */
function windowEndAfter(at: Date, w: Window, timeZone: string): Date {
  const endHH = String(Math.floor(w.endMin / 60)).padStart(2, "0");
  const endMM = String(w.endMin % 60).padStart(2, "0");
  const localDate = localDateStr(timeZone, at);
  let end = zonedTimeToUtc(localDate, `${endHH}:${endMM}`, timeZone);
  if (end.getTime() <= at.getTime()) {
    // The end time already passed today (e.g. a 22:00–08:00 window at 23:00 →
    // 08:00 is tomorrow). Roll to the next local day.
    const next = localDateStr(timeZone, new Date(at.getTime() + 24 * 3600_000));
    end = zonedTimeToUtc(next, `${endHH}:${endMM}`, timeZone);
  }
  return end;
}

export interface SendTime {
  sendAt: Date;
  deferred: boolean;
}

export interface ResolveOpts {
  urgent?: boolean;
  channel?: NotificationChannelName;
}

/**
 * If `desiredAt` falls inside quiet hours, push it to the window's end in the
 * user's local time; otherwise send when asked. Urgent kinds bypass entirely.
 *
 * Iterates so overlapping windows resolve correctly — deferring to one window's
 * end can land inside another (e.g. an SMS floor ending at 08:00 that lands in a
 * user's 07:00–09:00 window), so we re-check until the time is clear. The DST
 * correctness comes for free from zonedTimeToUtc: 08:00 local on a 23- or 25-hour
 * day maps to the right UTC instant.
 */
export function resolveSendTime(
  desiredAt: Date,
  prefs: QuietPrefs,
  timezone: string,
  opts: ResolveOpts = {},
): SendTime {
  if (opts.urgent) return { sendAt: desiredAt, deferred: false };

  const windows = windowsFor(prefs, opts.channel);
  if (windows.length === 0) return { sendAt: desiredAt, deferred: false };

  let sendAt = desiredAt;
  let deferred = false;
  for (let i = 0; i < 6; i++) {
    const minute = localMinutes(sendAt, timezone);
    // Among windows containing this instant, jump past the latest end.
    let latestEnd: Date | null = null;
    for (const w of windows) {
      if (!contains(w, minute)) continue;
      const end = windowEndAfter(sendAt, w, timezone);
      if (!latestEnd || end.getTime() > latestEnd.getTime()) latestEnd = end;
    }
    if (!latestEnd) break;
    sendAt = latestEnd;
    deferred = true;
  }
  return { sendAt, deferred };
}
