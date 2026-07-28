import { describe, it, expect } from "vitest";
import {
  buttonClasses,
  buttonState,
  controlClasses,
  describedBy,
  badgeClasses,
  priorityMeta,
  nextSegmentIndex,
} from "@/components/ui/styles";

describe("buttonClasses", () => {
  it("maps each variant to its distinctive class", () => {
    expect(buttonClasses("primary")).toContain("bg-accent");
    expect(buttonClasses("secondary")).toContain("border");
    expect(buttonClasses("ghost")).toContain("hover:bg-surface-2");
    expect(buttonClasses("danger")).toContain("text-bad");
  });

  it("maps size to padding and always carries the base + control radius", () => {
    expect(buttonClasses("primary", "sm")).toContain("px-3");
    expect(buttonClasses("primary", "md")).toContain("px-4");
    expect(buttonClasses("primary", "md")).toContain("rounded-control");
  });

  it("appends caller className last so overrides win in source order", () => {
    expect(buttonClasses("primary", "md", "w-full")).toMatch(/w-full$/);
  });
});

describe("buttonState", () => {
  it("loading implies disabled and reports aria-busy", () => {
    expect(buttonState({ loading: true })).toEqual({ disabled: true, ariaBusy: true });
  });

  it("disabled alone is not busy", () => {
    expect(buttonState({ disabled: true })).toEqual({ disabled: true, ariaBusy: false });
  });

  it("neither is a plain enabled button", () => {
    expect(buttonState({})).toEqual({ disabled: false, ariaBusy: false });
  });

  it("loading wins even when disabled is explicitly false", () => {
    expect(buttonState({ disabled: false, loading: true }).disabled).toBe(true);
  });
});

describe("controlClasses", () => {
  it("adds the error border only when there is an error", () => {
    expect(controlClasses(false)).not.toContain("border-bad");
    expect(controlClasses(true)).toContain("border-bad");
  });
});

describe("describedBy", () => {
  it("returns no ids without a control id", () => {
    expect(describedBy(undefined, true, false)).toEqual({
      describedById: undefined,
      messageId: undefined,
    });
  });

  it("returns no ids when there is nothing to describe", () => {
    expect(describedBy("email", false, false).describedById).toBeUndefined();
  });

  it("wires a message id off the control id when a hint or error exists", () => {
    expect(describedBy("email", true, false)).toEqual({
      describedById: "email-msg",
      messageId: "email-msg",
    });
    expect(describedBy("email", false, true).describedById).toBe("email-msg");
  });
});

describe("badge + priority mapping", () => {
  it("maps tones to their background", () => {
    expect(badgeClasses("good")).toContain("text-good");
    expect(badgeClasses("bad")).toContain("bg-bad/10");
    expect(badgeClasses()).toContain("text-text-dim"); // neutral default
  });

  it("maps priority 1..4 to tone and label", () => {
    expect(priorityMeta(1)).toEqual({ tone: "bad", label: "Urgent" });
    expect(priorityMeta(2)).toEqual({ tone: "accent", label: "High" });
    expect(priorityMeta(3)).toEqual({ tone: "neutral", label: "Normal" });
    expect(priorityMeta(4)).toEqual({ tone: "neutral", label: "Low" });
  });

  it("falls back to Normal for out-of-range priorities", () => {
    expect(priorityMeta(9)).toEqual({ tone: "neutral", label: "Normal" });
  });
});

describe("nextSegmentIndex (roving focus)", () => {
  it("wraps forward and backward", () => {
    expect(nextSegmentIndex(2, "ArrowRight", 3)).toBe(0);
    expect(nextSegmentIndex(0, "ArrowLeft", 3)).toBe(2);
  });

  it("treats vertical arrows like horizontal ones", () => {
    expect(nextSegmentIndex(0, "ArrowDown", 3)).toBe(1);
    expect(nextSegmentIndex(1, "ArrowUp", 3)).toBe(0);
  });

  it("jumps to the ends with Home/End", () => {
    expect(nextSegmentIndex(1, "Home", 3)).toBe(0);
    expect(nextSegmentIndex(1, "End", 3)).toBe(2);
  });

  it("returns null for keys that do not move focus", () => {
    expect(nextSegmentIndex(1, "Enter", 3)).toBeNull();
    expect(nextSegmentIndex(0, "ArrowRight", 0)).toBeNull();
  });
});
