import { describe, expect, it } from "vitest";
import { computeRecoveryStatus } from "@/lib/planning/readiness";

const NOW = new Date("2026-07-06T18:00:00Z").getTime();

describe("recovery status", () => {
  it("reports no data when nothing has been logged", () => {
    expect(computeRecoveryStatus(null, NOW).label).toBe("No data yet");
  });

  it("reports recovering within 20 hours of the last workout", () => {
    expect(computeRecoveryStatus("2026-07-06T02:00:00Z", NOW).label).toBe("Recovering");
  });

  it("reports ready between 20 and 72 hours", () => {
    expect(computeRecoveryStatus("2026-07-04T12:00:00Z", NOW).label).toBe("Ready");
  });

  it("reports well rested past 72 hours, with a day count", () => {
    const r = computeRecoveryStatus("2026-07-01T12:00:00Z", NOW);
    expect(r.label).toBe("Well rested");
    expect(r.detail).toContain("5 days");
  });
});
