import { CalendarEvent } from "@/lib/types";
import { zonedTimeToUtc } from "@/lib/utils";

/**
 * Pure Today-page computations, lifted out of the old 520-line page component so
 * they can be unit-tested (they had no coverage while buried in JSX). No React,
 * no Supabase — just data in, data out.
 */

export interface TimelineItem {
  /** ISO datetime (or date, for all-day). */
  start: string;
  end?: string;
  title: string;
  /** "event" = calendar, "block" = plan-placed work block. */
  kind: "event" | "block";
  sub?: string;
  allDay?: boolean;
}

export interface PlanBlock {
  start: string; // local "HH:MM"
  end: string;
  title: string;
}

/**
 * Merge Google events and plan-placed work blocks into one timeline. Plan
 * blocks carry local wall-clock times ("09:00"), converted to instants in the
 * user's timezone. Ordering is left to the Timeline component (it also marks
 * the "next" item), so this stays a pure merge/map.
 */
export function buildTimeline(
  events: CalendarEvent[],
  schedule: PlanBlock[] | undefined,
  today: string,
  tz: string,
): TimelineItem[] {
  return [
    ...events.map((e) => ({
      start: e.start,
      end: e.end,
      title: e.summary,
      kind: "event" as const,
      sub: e.isPrimary ? undefined : e.calendarSummary,
      allDay: e.allDay,
    })),
    ...(schedule ?? []).map((b) => ({
      start: zonedTimeToUtc(today, b.start, tz).toISOString(),
      end: zonedTimeToUtc(today, b.end, tz).toISOString(),
      title: b.title,
      kind: "block" as const,
    })),
  ];
}

export interface MacroTotals {
  kcal: number;
  p: number;
  c: number;
  f: number;
}

export interface MealMacros {
  calories?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
}

/** Sum a day's meals into calorie and macro totals, tolerating nulls. */
export function sumMacros(meals: MealMacros[]): MacroTotals {
  return meals.reduce(
    (acc, m) => ({
      kcal: acc.kcal + (m.calories ?? 0),
      p: acc.p + (m.protein_g ?? 0),
      c: acc.c + (m.carbs_g ?? 0),
      f: acc.f + (m.fat_g ?? 0),
    }),
    { kcal: 0, p: 0, c: 0, f: 0 },
  );
}

/** Time-of-day greeting and its glyph. Boundaries: <12 morning, <18 afternoon. */
export function greetingFor(hour: number): { greeting: string; emoji: string } {
  if (hour < 12) return { greeting: "Good morning", emoji: "☀️" };
  if (hour < 18) return { greeting: "Good afternoon", emoji: "🌤️" };
  return { greeting: "Good evening", emoji: "🌙" };
}

/** Count open tasks per workspace id, ignoring rows with no workspace. */
export function countOpenTasksByWorkspace(
  rows: { workspace_id: string | null }[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (!row.workspace_id) continue;
    counts[row.workspace_id] = (counts[row.workspace_id] ?? 0) + 1;
  }
  return counts;
}
