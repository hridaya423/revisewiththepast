import { describe, expect, test } from "vitest";

import { cellGeometry, layoutGrid } from "@/app/_components/paper-maker/dotcut/geometry";
import { SCENES, cellDelay, cellMotion, rasterize, styleField } from "@/app/_components/paper-maker/dotcut/scenes";

describe("dot-cut geometry", () => {
  test("insets touching circles by three quarters of one pitch and fits whole centered rows", () => {
    const layout = layoutGrid(420, 260, 42);
    expect(layout.pitch).toBeCloseTo(420 / 43.5);
    expect(layout.rows).toBe(25);
    expect(layout.offsetX).toBeCloseTo(layout.pitch * 0.75);
    expect(layout.offsetY).toBeCloseTo((260 - layout.rows * layout.pitch) / 2);
    expect(layout.offsetY).toBeGreaterThanOrEqual(layout.pitch * 0.75);
  });

  test("opens a cell by expanding its inner bore without shrinking its touching outer edge", () => {
    expect(cellGeometry(1, 0, 5, 1.5)).toEqual({ outerRadius: 5, boreRadius: 0 });
    expect(cellGeometry(0.5, 0, 5, 1.5)).toEqual({ outerRadius: 5, boreRadius: 2.5 });
    expect(cellGeometry(0, 0, 5, 1.5)).toEqual({ outerRadius: 5, boreRadius: 5 });
    expect(cellGeometry(1, 1, 5, 1.5)).toEqual({ outerRadius: 5, boreRadius: 3.5 });
  });
});

describe("dot-cut scenes", () => {
  test("keeps transition delays deterministic and bounded", () => {
    for (const transition of ["wipe", "ripple", "scatter", "collapse", "columns"] as const) {
      const first = cellDelay(transition, 8, 4, 42, 24, 0.37);
      expect(first).toBe(cellDelay(transition, 8, 4, 42, 24, 0.37));
      expect(first).toBeGreaterThanOrEqual(0);
      expect(first).toBeLessThanOrEqual(1);
    }
  });

  test("returns cells to the lattice at both ends of their motion slice", () => {
    for (const transition of ["wipe", "ripple", "scatter", "collapse", "columns"] as const) {
      expect(cellMotion(transition, 0, 1, 0.37)).toEqual({ scale: 1, dx: 0, dy: 0, spin: 0 });
      const finished = cellMotion(transition, 1, 1, 0.37);
      expect(finished.dx).toBeCloseTo(0);
      expect(finished.dy).toBeCloseTo(0);
      expect(finished.scale).toBeCloseTo(1);
    }
  });

  test("produces both carved and standing cells for every full-field scene", () => {
    for (const scene of SCENES.filter((candidate) => candidate.kind !== "text")) {
      const cells = rasterize(scene, 42, 24, "serif");
      expect(cells).toContain(0);
      expect(cells).toContain(1);
    }
  });

  test("textures standing cells with a non-uniform secondary field", () => {
    for (const scene of SCENES) {
      const field = new Float32Array(42 * 24);
      styleField(scene, 42, 24, 1, field);
      expect(Math.max(...field)).toBeGreaterThan(Math.min(...field));
      expect(Math.min(...field)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...field)).toBeLessThanOrEqual(1);
    }
  });
});
