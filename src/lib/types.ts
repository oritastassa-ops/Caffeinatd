/** Domain types shared across pipeline, views, and planning. */

export interface Profile {
  id: string;
  display_name: string;
  timezone: string;
  settings: UserSettings;
  onboarded_at: string | null;
}

export type CommunicationStyle = "supportive" | "analytical" | "coaching" | "casual";

export interface UserSettings {
  calorieGoal?: number;
  proteinGoal?: number;
  carbsGoal?: number;
  fatGoal?: number;
  sleepHours?: number;
  windDownMinutes?: number;
  communicationStyle?: CommunicationStyle;
  /** Typical workouts per week, used by the readiness score and fitness insights. */
  weeklyWorkoutTarget?: number;
  /** "Continue without integration" was clicked — don't show the connect-tracker card again. */
  fitnessOnboardingDismissed?: boolean;
  /** Per-exercise strength goals — few enough per user that a jsonb array beats a new table. */
  fitnessGoals?: FitnessGoal[];
  /** Display unit for weights; storage is always kg. */
  weightUnit?: "kg" | "lbs";
  /** Predefined training split id (see lib/fitness/programs.ts), or "custom". */
  trainingProgramId?: string;
}

export interface FitnessGoal {
  exercise: string;
  targetWeightKg: number;
  createdAt: string;
}

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  priority: 1 | 2 | 3 | 4;
  category: string | null;
  project: string | null;
  workspace_id: string | null;
  due_at: string | null;
  recurrence: string | null;
  completed_at: string | null;
  created_at: string;
}

/* ── Workspaces pillar ──────────────────────────────────────────────────── */

export const WORKSPACE_KINDS = [
  "development", "university", "premed", "research", "personal", "fitness", "custom",
] as const;
export type WorkspaceKind = (typeof WORKSPACE_KINDS)[number];

export interface Workspace {
  id: string;
  slug: string;
  name: string;
  kind: WorkspaceKind;
  icon: string;
  description: string | null;
  sort_order: number;
  archived_at: string | null;
  created_at: string;
}

export interface Note {
  id: string;
  workspace_id: string | null;
  title: string;
  content: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

export interface Capture {
  id: string;
  workspace_id: string | null;
  content: string;
  status: "inbox" | "processed" | "dismissed";
  processed_at: string | null;
  created_at: string;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  at: string;
}

export interface AIConversation {
  id: string;
  workspace_id: string | null;
  title: string;
  messages: ConversationMessage[];
  created_at: string;
  updated_at: string;
}

export interface Workout {
  id: string;
  performed_on: string;
  kind: "strength" | "cardio" | "mobility" | "other";
  title: string;
  duration_min: number | null;
  distance_km: number | null;
  notes: string | null;
  source: "manual" | "hevy";
  sets?: WorkoutSet[];
}

export interface WorkoutSet {
  id: string;
  exercise: string;
  set_no: number;
  reps: number | null;
  weight_kg: number | null;
}

export interface Meal {
  id: string;
  eaten_at: string;
  meal_type: "breakfast" | "lunch" | "dinner" | "snack" | null;
  description: string;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
}

export type MemoryKind = "preference" | "habit" | "relationship" | "routine" | "goal" | "event";

export interface Memory {
  id: string;
  kind: MemoryKind;
  content: string;
  importance: number;
  confidence: number;
  usage_count: number;
  created_at: string;
  updated_at: string;
}

export interface CalendarEvent {
  id: string;
  /** Which Google calendar this event lives on — needed to update/delete it later. */
  calendarId: string;
  /** Display name of that calendar (e.g. "Family", or the user's email for primary). */
  calendarSummary: string;
  /** True for the user's default calendar — Google's real id for it is their email, not "primary". */
  isPrimary: boolean;
  summary: string;
  start: string; // ISO datetime or date
  end: string;
  location?: string;
  allDay: boolean;
}

/** One executed assistant action — rendered as an undoable receipt chip. */
export interface ActionReceipt {
  tool: string;
  label: string;
  undo?: { table: string; id: string } | { calendarId: string; calendarEventId: string };
  /** Present instead of `undo` for inferred facts awaiting the user's Remember/Don't-remember choice. */
  confirm?: { kind: MemoryKind; content: string; importance: number };
}

export type InsightDomain = "fitness" | "nutrition" | "calendar" | "tasks" | "sleep" | "finance" | "home";

export interface Insight {
  id: string;
  domain: InsightDomain;
  message: string;
  reason: string;
  importance: number;
  created_at: string;
  acted_on: boolean;
  action_preset: string | null;
}

export interface Reminder {
  id: string;
  linked_table: "tasks" | "workouts" | "meals" | null;
  linked_id: string | null;
  message: string;
  remind_at: string;
  /** The reminder's channel intent; 'auto' delegates to notification preferences. */
  notification_type: "in_app" | "auto" | "email" | "sms";
  completed_at: string | null;
}

/** A tool call that failed — surfaced deterministically so the UI never has to trust the model's claim of success. */
export interface ActionFailure {
  tool: string;
  message: string;
}

export interface AssistantResponse {
  text: string;
  actions: ActionReceipt[];
  failures?: ActionFailure[];
}

export interface DailyPlan {
  date: string;
  overview: string;
  priorities: string[];
  workout: string;
  nutrition: string;
  freeWindows: string[];
  bedtime: string;
  /** One-line household picture (chores/collections/shopping); "" pre-Home-pillar plans. */
  home?: string;
  /** Time blocks the plan placed in the free windows — materialized as calendar events. */
  schedule?: { start: string; end: string; title: string }[];
}

/* ── Finance pillar ─────────────────────────────────────────────────────── */

export const ASSET_KINDS = [
  "cash", "checking", "savings", "tfsa", "fhsa", "rrsp",
  "brokerage", "crypto", "vehicle", "property", "other_asset",
] as const;
export const LIABILITY_KINDS = [
  "credit_card", "student_loan", "mortgage", "car_loan", "other_debt",
] as const;
export type AccountKind = (typeof ASSET_KINDS)[number] | (typeof LIABILITY_KINDS)[number];

/** Kinds counted as spendable for "Cash Available" and emergency-fund months. */
export const LIQUID_KINDS: AccountKind[] = ["cash", "checking", "savings"];

export interface FinanceAccount {
  id: string;
  name: string;
  kind: AccountKind;
  side: "asset" | "liability";
  balance: number;
  expected_return_pct: number | null;
  allocation: string | null;
  archived_at: string | null;
}

export const EXPENSE_CATEGORIES = [
  "housing", "food", "transportation", "health", "entertainment", "education",
  "subscriptions", "travel", "shopping", "utilities", "savings", "investments", "other",
] as const;
export const INCOME_CATEGORIES = [
  "salary", "freelance", "scholarship", "business", "dividends", "gift", "other",
] as const;
export type TransactionCategory = (typeof EXPENSE_CATEGORIES)[number] | (typeof INCOME_CATEGORIES)[number];

export interface FinanceTransaction {
  id: string;
  direction: "income" | "expense";
  amount: number;
  category: TransactionCategory;
  description: string;
  occurred_on: string;
  account_id: string | null;
  recurrence: string | null;
  recurrence_id: string | null;
}

export interface FinanceGoal {
  id: string;
  title: string;
  description: string | null;
  target_amount: number;
  current_amount: number;
  linked_account_id: string | null;
  monthly_contribution: number;
  priority: number;
  deadline: string | null;
  achieved_at: string | null;
}

export interface FinanceSnapshot {
  snapshot_date: string;
  net_worth: number;
  assets: number;
  liabilities: number;
}

export interface WeeklyFinanceReview {
  weekStart: string;
  narrative: string;
  income: number;
  expenses: number;
  savingsRate: number;
  netWorthChange: number | null;
  topCategories: { category: string; amount: number }[];
}

/* ── Home pillar ─────────────────────────────────────────────────────────── */

export interface Household {
  id: string;
  name: string;
  invite_code: string;
  created_by: string;
}

export interface HouseholdMember {
  id: string;
  household_id: string;
  user_id: string | null; // null = person without an account, still assignable
  name: string;
  initial: string;
  color: string;
  role: "owner" | "member";
}

export type ChoreCadence = "daily" | "weekly" | "monthly" | "one_time";

export const CHORE_CATEGORIES = [
  "kitchen", "bathroom", "bedroom", "living", "laundry", "outdoor",
  "pets", "plants", "maintenance", "errand", "other",
] as const;
export type ChoreCategory = (typeof CHORE_CATEGORIES)[number];

export interface Chore {
  id: string;
  household_id: string;
  title: string;
  description: string | null;
  cadence: ChoreCadence;
  category: ChoreCategory;
  priority: number;
  estimated_minutes: number | null;
  recurrence: string | null;
  anchor_date: string;
  assigned_member_id: string | null;
  rotate_assignment: boolean;
  archived_at: string | null;
}

export interface ChoreCompletion {
  id: string;
  chore_id: string;
  member_id: string | null;
  completed_on: string;
}

export const COLLECTION_TYPES = [
  "garbage", "recycling", "compost", "yard_waste", "bulk", "hazardous",
] as const;
export type CollectionType = (typeof COLLECTION_TYPES)[number];

export interface CollectionSchedule {
  id: string;
  type: CollectionType;
  day_of_week: number; // 0 = Sunday
  frequency: "weekly" | "biweekly" | "monthly";
  anchor_date: string;
  bin_label: string | null;
  notes: string | null;
  reminder_night_before: boolean;
}

export const SHOPPING_CATEGORIES = [
  "produce", "bakery", "dairy", "frozen", "meat", "seafood", "pantry",
  "snacks", "drinks", "cleaning", "toiletries", "pets", "other",
] as const;
export type ShoppingCategory = (typeof SHOPPING_CATEGORIES)[number];

export interface ShoppingList {
  id: string;
  name: string;
  archived_at: string | null;
}

export interface ShoppingItem {
  id: string;
  list_id: string;
  name: string;
  quantity: string | null;
  category: ShoppingCategory;
  priority: number;
  note: string | null;
  added_by_member_id: string | null;
  completed_at: string | null;
}
