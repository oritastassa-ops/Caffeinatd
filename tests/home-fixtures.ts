import { Chore, ChoreCompletion, CollectionSchedule, HouseholdMember } from "@/lib/types";

export function chore(overrides: Partial<Chore>): Chore {
  return {
    id: "c1", household_id: "h1", title: "Vacuum", description: null,
    cadence: "weekly", category: "living", priority: 3, estimated_minutes: null,
    recurrence: null, anchor_date: "2026-06-01", assigned_member_id: null,
    rotate_assignment: false, archived_at: null, ...overrides,
  };
}

export function completion(overrides: Partial<ChoreCompletion>): ChoreCompletion {
  return { id: "cc1", chore_id: "c1", member_id: null, completed_on: "2026-06-01", ...overrides };
}

export function member(overrides: Partial<HouseholdMember>): HouseholdMember {
  return {
    id: "m1", household_id: "h1", user_id: null, name: "Alex", initial: "A",
    color: "#d97706", role: "member", ...overrides,
  };
}

export function schedule(overrides: Partial<CollectionSchedule>): CollectionSchedule {
  return {
    id: "s1", type: "garbage", day_of_week: 2, frequency: "weekly",
    anchor_date: "2026-06-02", bin_label: null, notes: null, reminder_night_before: true,
    ...overrides,
  };
}
