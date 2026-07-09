import { describe, expect, it } from "vitest";
import { getProgram, recommendProgramSession } from "@/lib/fitness/programs";

const TODAY = "2026-07-06";

describe("workout program recommendation", () => {
  it("recommends the next session after the last completed one", () => {
    const program = getProgram("upper_lower")!;
    const rec = recommendProgramSession(
      program,
      [{ performed_on: "2026-07-05", title: "Lower A" }],
      [],
      TODAY,
    );
    expect(rec.fromProgram).toBe(true);
    expect(rec.nextSession).toBe("Upper B");
    expect(rec.reason).toContain("Lower A");
  });

  it("distinguishes a workout DAY from a muscle — recommends a session name, not 'shoulders'", () => {
    const program = getProgram("upper_lower")!;
    const rec = recommendProgramSession(
      program,
      [{ performed_on: "2026-07-05", title: "Lower A" }],
      [],
      TODAY,
    );
    expect(rec.label).toBe("Upper B");
    expect(rec.label.toLowerCase()).not.toContain("shoulder");
  });

  it("matches the most specific day keyword (Upper B beats generic Upper)", () => {
    const program = getProgram("upper_lower")!;
    const rec = recommendProgramSession(
      program,
      [{ performed_on: "2026-07-05", title: "Upper B" }],
      [],
      TODAY,
    );
    expect(rec.nextSession).toBe("Lower B"); // day after Upper B
  });

  it("wraps around the rotation", () => {
    const program = getProgram("ppl")!;
    const rec = recommendProgramSession(program, [{ performed_on: "2026-07-05", title: "Legs" }], [], TODAY);
    expect(rec.nextSession).toBe("Push");
  });

  it("starts at day 1 when no prior workout matches the program", () => {
    const program = getProgram("upper_lower")!;
    const rec = recommendProgramSession(program, [{ performed_on: "2026-07-05", title: "Random cardio" }], [], TODAY);
    expect(rec.nextSession).toBe("Upper A");
  });

  it("suggests rest-or-next when the last session was today", () => {
    const program = getProgram("ppl")!;
    const rec = recommendProgramSession(program, [{ performed_on: TODAY, title: "Push Day" }], [], TODAY);
    expect(rec.reason).toContain("already completed");
    expect(rec.nextSession).toBe("Pull");
  });

  it("falls back to muscle-based recommendation with no program", () => {
    const rec = recommendProgramSession(null, [], [{ group: "chest", percent: 100, label: "Ready", detail: "", lastTrainedOn: "2026-07-01" }], TODAY);
    expect(rec.fromProgram).toBe(false);
    expect(rec.label).toBe("Chest");
  });
});
