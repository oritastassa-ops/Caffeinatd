import { describe, expect, it } from "vitest";
import { formatWeight, kgToUnit, unitToKg, weightValue } from "@/lib/fitness/units";

describe("weight units", () => {
  it("converts kg to lbs and back losslessly enough", () => {
    expect(Math.round(kgToUnit(100, "lbs"))).toBe(220);
    expect(Math.round(unitToKg(220, "lbs"))).toBe(100);
  });

  it("passes kg through unchanged", () => {
    expect(kgToUnit(100, "kg")).toBe(100);
    expect(unitToKg(100, "kg")).toBe(100);
  });

  it("formats with the unit label, rounding lbs whole and kg to 1 decimal", () => {
    expect(formatWeight(100, "lbs")).toBe("220 lbs");
    expect(formatWeight(102.5, "kg")).toBe("102.5 kg");
    expect(formatWeight(100, "kg")).toBe("100 kg");
  });

  it("shows 'bw' for null weight in compact value form", () => {
    expect(weightValue(null, "kg")).toBe("bw");
    expect(weightValue(60, "lbs")).toBe("132");
  });
});
