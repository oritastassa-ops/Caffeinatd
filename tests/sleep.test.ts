import { describe, expect, it } from "vitest";
import { recommendSleep } from "@/lib/planning/sleep";

describe("sleep recommendation", () => {
  it("defaults to 07:30 wake / 23:30 bed with 8h goal and open morning", () => {
    const rec = recommendSleep(null, {});
    expect(rec.wake).toBe("07:30");
    expect(rec.bedtime).toBe("23:30");
    expect(rec.windDownStart).toBe("23:00");
  });

  it("moves wake earlier for an early commitment (event − 60min prep)", () => {
    const rec = recommendSleep({ time: "07:00", summary: "Flight" }, { sleepHours: 8 });
    expect(rec.wake).toBe("06:00");
    expect(rec.bedtime).toBe("22:00");
    expect(rec.rationale).toContain("Flight");
  });

  it("keeps the default wake when the first event is late", () => {
    const rec = recommendSleep({ time: "11:00", summary: "Brunch" }, {});
    expect(rec.wake).toBe("07:30");
  });

  it("never recommends waking before 04:00", () => {
    const rec = recommendSleep({ time: "04:15", summary: "Airport" }, { sleepHours: 8 });
    expect(rec.wake).toBe("04:00");
    expect(rec.bedtime).toBe("20:00");
  });

  it("respects custom sleep + wind-down settings across midnight", () => {
    const rec = recommendSleep(null, { sleepHours: 7, windDownMinutes: 45 });
    expect(rec.bedtime).toBe("00:30");
    expect(rec.windDownStart).toBe("23:45");
  });
});
