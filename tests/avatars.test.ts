import { describe, expect, it } from "vitest";
import { PIXEL_CHARACTERS } from "@/components/avatars/pixel-data";
import { PERSONALITIES, PERSONALITY_LIST } from "@/lib/personalities";
import { CommunicationStyle } from "@/lib/types";

const STYLES: CommunicationStyle[] = ["supportive", "analytical", "coaching", "casual"];

describe("pixel character grid integrity", () => {
  for (const style of STYLES) {
    const character = PIXEL_CHARACTERS[style];

    it(`${style}: native 32×32 (not scaled 16×16)`, () => {
      expect(character.size).toBe(32);
    });

    for (const [frameName, grid] of Object.entries(character.frames)) {
      it(`${style}/${frameName}: ${character.size}×${character.size} with only palette keys`, () => {
        expect(grid).toHaveLength(character.size);
        grid.forEach((row, i) => {
          expect(row, `${style}/${frameName} row ${i} is ${row.length} wide`).toHaveLength(
            character.size,
          );
          for (const ch of row) {
            if (ch === ".") continue;
            expect(
              character.palette[ch],
              `unknown palette key "${ch}" in ${style}/${frameName} row "${row}"`,
            ).toBeDefined();
          }
        });
      });
    }

    it(`${style}: blink and action frames actually differ from base`, () => {
      expect(character.frames.blink.join("\n")).not.toBe(character.frames.base.join("\n"));
      expect(character.frames.action.join("\n")).not.toBe(character.frames.base.join("\n"));
    });
  }
});

describe("personality registry", () => {
  it("covers every communication style with art and metadata", () => {
    for (const style of STYLES) {
      expect(PERSONALITIES[style].name.length).toBeGreaterThan(0);
      expect(PERSONALITIES[style].sample.length).toBeGreaterThan(10);
      expect(PIXEL_CHARACTERS[style]).toBeDefined();
    }
    expect(PERSONALITY_LIST.map((p) => p.id).sort()).toEqual([...STYLES].sort());
  });
});
