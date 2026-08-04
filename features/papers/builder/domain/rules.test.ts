import { describe, expect, it } from "vitest";
import { clampMarks, clampTimeMinutes, recommendedPaperCodes } from "./rules";

describe("paper builder rules", () => {
  it("keeps marks and time inside the builder bounds", () => {
    expect(clampMarks(1)).toBe(10);
    expect(clampMarks(999)).toBe(120);
    expect(clampTimeMinutes(1)).toBe(15);
    expect(clampTimeMinutes(999)).toBe(300);
  });

  it("recommends all science papers for selected science groups", () => {
    expect(recommendedPaperCodes("edexcel-combined-science", new Set(["biology"]), ["biology-1", "biology-2", "chemistry-1"])).toEqual(["biology-1", "biology-2"]);
  });
});
