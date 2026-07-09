import { UserSettings } from "@/lib/types";

export interface SleepRecommendation {
  bedtime: string; // "HH:MM" local
  wake: string;
  windDownStart: string;
  rationale: string;
}

/**
 * Deterministic sleep math (the LLM only phrases it):
 * wake = first commitment tomorrow − prep buffer; bedtime = wake − sleep goal.
 */
export function recommendSleep(
  firstEventTomorrowLocal: { time: string; summary: string } | null,
  settings: UserSettings,
): SleepRecommendation {
  const sleepHours = settings.sleepHours ?? 8;
  const windDown = settings.windDownMinutes ?? 30;
  const prepMinutes = 60;

  const defaultWake = 7 * 60 + 30; // 07:30 when tomorrow is open
  let wakeMin = defaultWake;
  let reason = "no early commitments tomorrow";

  if (firstEventTomorrowLocal) {
    const [h = 0, m = 0] = firstEventTomorrowLocal.time.split(":").map(Number);
    const eventMin = h * 60 + m;
    const neededWake = eventMin - prepMinutes;
    if (neededWake < defaultWake) {
      wakeMin = Math.max(neededWake, 4 * 60); // never recommend waking before 04:00
      reason = `"${firstEventTomorrowLocal.summary}" at ${firstEventTomorrowLocal.time}`;
    } else {
      reason = `first commitment ("${firstEventTomorrowLocal.summary}") isn't until ${firstEventTomorrowLocal.time}`;
    }
  }

  const bedMin = (wakeMin - sleepHours * 60 + 24 * 60) % (24 * 60);
  const windDownMin = (bedMin - windDown + 24 * 60) % (24 * 60);

  return {
    bedtime: toHHMM(bedMin),
    wake: toHHMM(wakeMin),
    windDownStart: toHHMM(windDownMin),
    rationale: `${sleepHours}h target; ${reason}`,
  };
}

function toHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = Math.round(minutes % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
