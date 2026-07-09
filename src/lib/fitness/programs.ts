import { MuscleRecovery } from "./recovery";
import { recommendNextWorkout, WorkoutRecommendation } from "./recommend";

/**
 * Training-split awareness. The key idea the assistant was missing: a
 * workout DAY (e.g. "Upper A") is not a muscle. When a user follows a split,
 * the right recommendation is the next SESSION in the rotation, not whichever
 * muscle group happens to be most recovered.
 */

export interface ProgramDay {
  name: string; // "Upper A"
  focus: string; // human-readable muscle summary
  keywords: string[]; // lowercased tokens for matching a logged workout's title to this day
}

export interface TrainingProgram {
  id: string;
  name: string;
  days: ProgramDay[];
}

export const PROGRAMS: TrainingProgram[] = [
  {
    id: "upper_lower",
    name: "Upper / Lower",
    days: [
      { name: "Upper A", focus: "Chest, Back, Shoulders, Arms", keywords: ["upper a", "upper"] },
      { name: "Lower A", focus: "Quads, Hamstrings, Calves", keywords: ["lower a", "lower"] },
      { name: "Upper B", focus: "Back, Chest, Shoulders, Arms", keywords: ["upper b"] },
      { name: "Lower B", focus: "Hamstrings, Quads, Glutes, Calves", keywords: ["lower b"] },
    ],
  },
  {
    id: "ppl",
    name: "Push / Pull / Legs",
    days: [
      { name: "Push", focus: "Chest, Shoulders, Triceps", keywords: ["push"] },
      { name: "Pull", focus: "Back, Biceps, Rear Delts", keywords: ["pull"] },
      { name: "Legs", focus: "Quads, Hamstrings, Glutes, Calves", keywords: ["legs", "leg"] },
    ],
  },
  {
    id: "full_body",
    name: "Full Body",
    days: [
      { name: "Full Body A", focus: "Squat, Push, Pull", keywords: ["full body a", "full body", "fullbody"] },
      { name: "Full Body B", focus: "Hinge, Push, Pull", keywords: ["full body b"] },
      { name: "Full Body C", focus: "Squat, Vertical Push, Vertical Pull", keywords: ["full body c"] },
    ],
  },
];

export function getProgram(id: string | undefined): TrainingProgram | null {
  if (!id) return null;
  return PROGRAMS.find((p) => p.id === id) ?? null;
}

/** Which program day (index) does a workout title best match? -1 if none. */
function matchDayIndex(program: TrainingProgram, title: string): number {
  const t = title.toLowerCase();
  // Prefer the most specific keyword match (longest keyword) so "Upper B"
  // beats the generic "upper" that also belongs to Upper A.
  let best = -1;
  let bestLen = 0;
  program.days.forEach((day, i) => {
    for (const kw of day.keywords) {
      if (t.includes(kw) && kw.length > bestLen) {
        best = i;
        bestLen = kw.length;
      }
    }
  });
  return best;
}

export interface ProgramRecommendation extends WorkoutRecommendation {
  /** True when the pick came from the program rotation vs. a recovery fallback. */
  fromProgram: boolean;
  nextSession?: string;
}

/**
 * Recommends the next session in the program rotation based on the most
 * recent workout that matched a program day. Falls back to the muscle-based
 * recommendation when nothing matches (e.g. first workout, generic titles).
 */
export function recommendProgramSession(
  program: TrainingProgram | null,
  recentWorkouts: { performed_on: string; title: string }[],
  recovery: MuscleRecovery[],
  today: string,
): ProgramRecommendation {
  if (!program) {
    return { ...recommendNextWorkout(recovery), fromProgram: false };
  }

  // recentWorkouts newest-first; find the latest that maps to a program day.
  let lastIdx = -1;
  let lastDate: string | null = null;
  for (const w of recentWorkouts) {
    const idx = matchDayIndex(program, w.title);
    if (idx !== -1) {
      lastIdx = idx;
      lastDate = w.performed_on;
      break;
    }
  }

  if (lastIdx === -1) {
    const first = program.days[0]!;
    return {
      label: first.name,
      reason: `Starting your ${program.name} rotation with ${first.name} (${first.focus}).`,
      fromProgram: true,
      nextSession: first.name,
    };
  }

  const nextDay = program.days[(lastIdx + 1) % program.days.length]!;
  const lastDay = program.days[lastIdx]!;
  const trainedToday = lastDate === today;

  return {
    label: trainedToday ? "Rest or " + nextDay.name : nextDay.name,
    reason: trainedToday
      ? `You already completed ${lastDay.name} today. ${nextDay.name} (${nextDay.focus}) is next — or take a rest day.`
      : `You completed ${lastDay.name}${lastDate ? ` on ${lastDate}` : ""}. ${nextDay.name} (${nextDay.focus}) is next in your ${program.name} rotation.`,
    fromProgram: true,
    nextSession: nextDay.name,
  };
}
