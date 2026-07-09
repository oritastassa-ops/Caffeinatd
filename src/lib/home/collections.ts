import { CollectionSchedule } from "@/lib/types";

/**
 * Deterministic municipal-collection math. Biweekly parity and monthly
 * week-of-month both resolve from anchor_date — where garbage-day logic
 * usually goes wrong, so it's unit-tested hard.
 */

const TYPE_LABELS: Record<string, string> = {
  garbage: "Garbage",
  recycling: "Recycling",
  compost: "Compost",
  yard_waste: "Yard waste",
  bulk: "Bulk pickup",
  hazardous: "Hazardous waste",
};

export function collectionLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

/** Next collection date on-or-after `fromDate` (YYYY-MM-DD, both). */
export function nextCollection(schedule: CollectionSchedule, fromDate: string): string {
  let d = new Date(`${fromDate}T00:00:00Z`);
  // Walk to the next matching weekday, then apply frequency constraints.
  for (let i = 0; i < 400; i++) {
    if (d.getUTCDay() === schedule.day_of_week && matchesFrequency(schedule, d)) {
      return d.toISOString().slice(0, 10);
    }
    d = new Date(d.getTime() + 86_400_000);
  }
  return fromDate; // unreachable with valid data; safe fallback
}

function matchesFrequency(schedule: CollectionSchedule, d: Date): boolean {
  if (schedule.frequency === "weekly") return true;
  const anchor = new Date(`${schedule.anchor_date}T00:00:00Z`);
  if (schedule.frequency === "biweekly") {
    const weeks = Math.floor((d.getTime() - startOfWeek(anchor).getTime()) / (7 * 86_400_000));
    return weeks % 2 === 0;
  }
  // monthly: same week-of-month as the anchor (1st Tuesday, 2nd Friday, …)
  return weekOfMonth(d) === weekOfMonth(anchor);
}

function startOfWeek(d: Date): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() - out.getUTCDay());
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

function weekOfMonth(d: Date): number {
  return Math.floor((d.getUTCDate() - 1) / 7) + 1;
}

export interface CollectionStatus {
  type: string;
  label: string;       // "Garbage goes out tonight" / "Tomorrow is recycling day" / "Recycling day is today"
  date: string;
  urgency: "today" | "tonight" | "upcoming";
}

/** Human status lines for collections happening today or tomorrow. */
export function collectionStatuses(
  schedules: CollectionSchedule[],
  today: string,
): CollectionStatus[] {
  const tomorrow = new Date(new Date(`${today}T00:00:00Z`).getTime() + 86_400_000)
    .toISOString()
    .slice(0, 10);
  const out: CollectionStatus[] = [];
  for (const s of schedules) {
    const next = nextCollection(s, today);
    const name = collectionLabel(s.type);
    if (next === today) {
      out.push({ type: s.type, label: `${name} day is today.`, date: next, urgency: "today" });
    } else if (next === tomorrow) {
      out.push({
        type: s.type,
        label: s.reminder_night_before ? `${name} goes out tonight.` : `Tomorrow is ${name.toLowerCase()} day.`,
        date: next,
        urgency: "tonight",
      });
    }
  }
  return out.sort((a, b) => (a.urgency === "today" ? -1 : 1) - (b.urgency === "today" ? -1 : 1));
}
