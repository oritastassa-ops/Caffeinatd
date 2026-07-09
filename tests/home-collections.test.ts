import { describe, expect, it } from "vitest";
import { collectionStatuses, nextCollection } from "@/lib/home/collections";
import { categorizeItem } from "@/lib/home/categorize";
import { schedule } from "./home-fixtures";

// 2026-07-06 is a Monday; 2026-07-07 a Tuesday.

describe("nextCollection", () => {
  it("weekly: next matching weekday, including today", () => {
    const s = schedule({ day_of_week: 2, frequency: "weekly" }); // Tuesday
    expect(nextCollection(s, "2026-07-06")).toBe("2026-07-07");
    expect(nextCollection(s, "2026-07-07")).toBe("2026-07-07"); // today counts
    expect(nextCollection(s, "2026-07-08")).toBe("2026-07-14");
  });

  it("biweekly: honors parity from the anchor week", () => {
    // Anchor Tuesday 2026-06-02. Weeks of 2026-06-02, -16, -30, 07-14, 07-28 are "on".
    const s = schedule({ day_of_week: 2, frequency: "biweekly", anchor_date: "2026-06-02" });
    expect(nextCollection(s, "2026-07-06")).toBe("2026-07-14"); // skips off-week 07-07
    expect(nextCollection(s, "2026-07-15")).toBe("2026-07-28");
  });

  it("monthly: same week-of-month as the anchor", () => {
    // Anchor 2026-06-02 = 1st Tuesday → next 1st-Tuesday after 2026-07-08 is 2026-08-04.
    const s = schedule({ day_of_week: 2, frequency: "monthly", anchor_date: "2026-06-02" });
    expect(nextCollection(s, "2026-07-01")).toBe("2026-07-07"); // 1st Tuesday of July
    expect(nextCollection(s, "2026-07-08")).toBe("2026-08-04");
  });
});

describe("collectionStatuses", () => {
  it("says 'goes out tonight' the evening before, respecting the reminder flag", () => {
    const s = schedule({ day_of_week: 2, frequency: "weekly", reminder_night_before: true });
    const statuses = collectionStatuses([s], "2026-07-06"); // Monday, pickup Tuesday
    expect(statuses).toHaveLength(1);
    expect(statuses[0]!.label).toBe("Garbage goes out tonight.");
    expect(statuses[0]!.urgency).toBe("tonight");
  });

  it("says 'day is today' on the day itself and stays quiet otherwise", () => {
    const s = schedule({ day_of_week: 2, frequency: "weekly", type: "recycling" });
    expect(collectionStatuses([s], "2026-07-07")[0]!.label).toBe("Recycling day is today.");
    expect(collectionStatuses([s], "2026-07-09")).toHaveLength(0);
  });
});

describe("shopping keyword categorization (manual-add fallback)", () => {
  it("categorizes common groceries", () => {
    expect(categorizeItem("2 cartons of milk")).toBe("dairy");
    expect(categorizeItem("bananas")).toBe("produce");
    expect(categorizeItem("toilet paper")).toBe("toiletries");
    expect(categorizeItem("500g ground beef")).toBe("meat");
    expect(categorizeItem("dish soap")).toBe("cleaning");
    expect(categorizeItem("coffee beans")).toBe("drinks");
  });

  it("order matters: frozen beats produce words", () => {
    expect(categorizeItem("frozen berries")).toBe("frozen");
  });

  it("falls back to other", () => {
    expect(categorizeItem("mystery gadget")).toBe("other");
  });
});
