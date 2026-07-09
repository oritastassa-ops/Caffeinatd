import { HevyApiError } from "./errors";

/**
 * Raw Hevy API wrapper — typed directly from the live spec at
 * https://api.hevyapp.com/docs/json (confirmed, not assumed). Auth is a
 * single `api-key` header (a UUID from https://hevy.com/settings?developer),
 * not OAuth. Nothing outside this file should know Hevy's wire format.
 */

const BASE_URL = "https://api.hevyapp.com";

export interface HevySet {
  index: number;
  type: "normal" | "warmup" | "dropset" | "failure" | string;
  weight_kg: number | null;
  reps: number | null;
  distance_meters: number | null;
  duration_seconds: number | null;
  rpe: number | null;
  custom_metric: number | null;
}

export interface HevyExercise {
  index: number;
  title: string;
  notes: string | null;
  exercise_template_id: string;
  supersets_id: number | null;
  sets: HevySet[];
}

export interface HevyWorkout {
  id: string;
  title: string;
  routine_id: string | null;
  description: string | null;
  start_time: string;
  end_time: string;
  updated_at: string;
  created_at: string;
  exercises: HevyExercise[];
}

export interface HevyUserInfo {
  id: string;
  name: string;
  url: string;
}

export type HevyWorkoutEvent =
  | { type: "updated"; workout: HevyWorkout }
  | { type: "deleted"; id: string; deleted_at: string };

interface WorkoutEventsPage {
  page: number;
  page_count: number;
  events: HevyWorkoutEvent[];
}

async function hevyFetch<T>(apiKey: string, path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      headers: { "api-key": apiKey },
    });
  } catch {
    throw new HevyApiError("Network error reaching Hevy", undefined, true);
  }
  if (!res.ok) {
    throw new HevyApiError(
      `Hevy ${res.status}`,
      res.status,
      res.status === 429 || res.status >= 500,
    );
  }
  return res.json() as Promise<T>;
}

export async function getUserInfo(apiKey: string): Promise<HevyUserInfo> {
  const { data } = await hevyFetch<{ data: HevyUserInfo }>(apiKey, "/v1/user/info");
  return data;
}

/** Most-recent-first; used only to show a "latest workout" preview during connection test. */
export async function getMostRecentWorkout(apiKey: string): Promise<HevyWorkout | null> {
  const { workouts } = await hevyFetch<{ page: number; page_count: number; workouts: HevyWorkout[] }>(
    apiKey,
    "/v1/workouts?page=1&pageSize=1",
  );
  return workouts[0] ?? null;
}

/**
 * The whole sync engine rides on this one endpoint: `since` defaults to the
 * epoch, so the same call backfills history on first connect and picks up
 * only what changed on every sync after that — no custom cursor needed.
 */
export async function getWorkoutEventsPage(
  apiKey: string,
  since: string,
  page: number,
): Promise<WorkoutEventsPage> {
  const params = new URLSearchParams({ since, page: String(page), pageSize: "10" });
  return hevyFetch<WorkoutEventsPage>(apiKey, `/v1/workouts/events?${params}`);
}

/** Pages through every event since `since`, in the order Hevy returns them. */
export async function getAllWorkoutEventsSince(apiKey: string, since: string): Promise<HevyWorkoutEvent[]> {
  const first = await getWorkoutEventsPage(apiKey, since, 1);
  const all = [...first.events];
  for (let page = 2; page <= first.page_count; page++) {
    const next = await getWorkoutEventsPage(apiKey, since, page);
    all.push(...next.events);
  }
  return all;
}
