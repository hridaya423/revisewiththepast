import { describe, expect, it } from "vitest";
import { clampLocalCropBox, isValidLocalCropBox, toPdfCropBox } from "./crop-geometry";

describe("crop geometry", () => {
  it("translates local extraction coordinates through a non-zero PDF CropBox origin", () => {
    expect(toPdfCropBox(
      { left: 4, right: 100, bottom: 12, top: 220 },
      { x: 18, y: 26, width: 200, height: 300 },
    )).toEqual({ left: 22, right: 118, bottom: 38, top: 246 });
  });

  it("clamps oversize local crops without changing their meaning", () => {
    const crop = clampLocalCropBox(
      { left: -10, right: 240, bottom: -4, top: 340 },
      200,
      300,
    );
    expect(crop).toEqual({ left: 0, right: 200, bottom: 0, top: 300 });
    expect(isValidLocalCropBox(crop, 200, 300, 36)).toBe(true);
  });

  it("rejects inverted or effectively empty crops", () => {
    expect(isValidLocalCropBox({ left: 20, right: 20.5, bottom: 0, top: 100 }, 200, 300, 36)).toBe(false);
    expect(isValidLocalCropBox({ left: 20, right: 100, bottom: 80, top: 100 }, 200, 300, 36)).toBe(false);
  });
});
