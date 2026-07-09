/**
 * Weight display units. Everything is STORED in kg (one representation for
 * all deterministic math); this layer converts only for display and for
 * parsing user input back to kg.
 */

export type WeightUnit = "kg" | "lbs";

const LBS_PER_KG = 2.2046226218;

export function kgToUnit(kg: number, unit: WeightUnit): number {
  return unit === "lbs" ? kg * LBS_PER_KG : kg;
}

export function unitToKg(value: number, unit: WeightUnit): number {
  return unit === "lbs" ? value / LBS_PER_KG : value;
}

/** Rounds sensibly per unit: kg to 1 decimal (trimmed), lbs to whole numbers. */
export function formatWeight(kg: number | null | undefined, unit: WeightUnit): string {
  if (kg === null || kg === undefined) return "—";
  const v = kgToUnit(kg, unit);
  const rounded = unit === "lbs" ? Math.round(v) : Math.round(v * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)} ${unit}`;
}

/** Bare number (no unit label) — for compact chips/tables. */
export function weightValue(kg: number | null | undefined, unit: WeightUnit): string {
  if (kg === null || kg === undefined) return "bw";
  const v = kgToUnit(kg, unit);
  const rounded = unit === "lbs" ? Math.round(v) : Math.round(v * 10) / 10;
  return rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1);
}

/** Volume totals are large; show them in the chosen unit, rounded to whole. */
export function formatVolume(kg: number, unit: WeightUnit): string {
  return `${Math.round(kgToUnit(kg, unit)).toLocaleString()} ${unit}`;
}
