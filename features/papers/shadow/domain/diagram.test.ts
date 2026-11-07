import { describe, expect, it } from "vitest";
import { diagramSchema } from "../contracts/shadow-paper";
import { JUNE_2019_PAPER_1_TEMPLATES } from "../content/edexcel-higher/pilot";
import { math } from "./content";
import { DiagramBuilder, POINTS_PER_CM, clipLineToWindow, coordinateGrid, diagramLabels, validateDiagram } from "./diagram";
import { generateUnitVariant } from "./template-registry";

const failing = (checks: ReturnType<typeof validateDiagram>) => checks.filter((entry) => !entry.ok).map((entry) => entry.name);

describe("diagram primitives", () => {
  it("maps grid units to exact points in both directions", () => {
    const grid = coordinateGrid({ xMin: -1, xMax: 3, yMin: -3, yMax: 1, unit: 56.7, minorPerUnit: 10, labelStep: 1, margin: { left: 24, right: 24, top: 20, bottom: 18 } });
    const [ox, oy] = grid.toDiagram(0, 0);
    const [px, py] = grid.toDiagram(2, -1);
    expect(px - ox).toBeCloseTo(2 * 56.7, 9);
    expect(py - oy).toBeCloseTo(56.7, 9);
    expect(grid.fromDiagram(px, py)[0]).toBeCloseTo(2, 9);
    expect(grid.fromDiagram(px, py)[1]).toBeCloseTo(-1, 9);
    const diagram = grid.builder.build("calibrated", "grid");
    expect(diagramSchema.parse(diagram)).toBeTruthy();
    expect(failing(validateDiagram(diagram))).toEqual([]);
  });

  it("uses a true centimetre for calibrated centimetre grids", () => {
    expect(POINTS_PER_CM * 2.54).toBeCloseTo(72, 12);
  });

  it("clips lines to the window and rejects lines outside it", () => {
    const window = { xMin: -1, xMax: 3, yMin: -3, yMax: 1 };
    const [a, b] = clipLineToWindow(1, 1, 0, window);
    expect(a).toEqual([-1, 1]);
    expect(b).toEqual([3, -3]);
    expect(() => clipLineToWindow(0, 1, 5, window)).toThrow(/does not cross/u);
  });

  it("flags items outside the frame, overlapping labels and non-finite values", () => {
    const outside = new DiagramBuilder(100, 100).line(0, 0, 120, 10).build("not-to-scale", "x");
    expect(failing(validateDiagram(outside))).toEqual(["diagram:within-bounds"]);
    const collide = new DiagramBuilder(100, 100).label(20, 20, "label").label(22, 21, "label").build("not-to-scale", "x");
    expect(failing(validateDiagram(collide))).toEqual(["diagram:labels-separate"]);
    const nan = new DiagramBuilder(100, 100).circle(50, Number.NaN, 4).build("not-to-scale", "x");
    expect(failing(validateDiagram(nan))).toContain("diagram:finite");
  });

  it("measures half ellipses by the half that is drawn", () => {
    const lower = new DiagramBuilder(100, 60).ellipse(50, 10, 40, 40, { half: "lower" }).build("not-to-scale", "x");
    expect(failing(validateDiagram(lower))).toEqual([]);
    const upper = new DiagramBuilder(100, 60).ellipse(50, 10, 40, 40, { half: "upper" }).build("not-to-scale", "x");
    expect(failing(validateDiagram(upper))).toEqual(["diagram:within-bounds"]);
  });

  it("lists label text for cross-checking prose", () => {
    const diagram = new DiagramBuilder(100, 40).label(10, 20, [math("12 cm")]).build("not-to-scale", "x");
    expect(diagramLabels(diagram)).toEqual(["12cm"]);
  });
});

describe("pilot figures", () => {
  const figures = (template: (typeof JUNE_2019_PAPER_1_TEMPLATES)[number], seed: string) => {
    const unit = generateUnitVariant(template, { paperSeed: seed, displayOrder: template.sourceQuestionNumber });
    const blocks = [...unit.question.stem, ...unit.question.parts.flatMap((part) => [...part.lead, ...part.prompt])];
    return { unit, diagrams: blocks.flatMap((block) => (block.b === "figure" ? [block.diagram] : [])) };
  };

  it("keep every generated figure valid, in bounds and within the page width", () => {
    for (const template of JUNE_2019_PAPER_1_TEMPLATES) {
      for (let index = 0; index < 25; index += 1) {
        const { diagrams } = figures(template, `figure-seed-${index}`);
        for (const diagram of diagrams) {
          expect(diagramSchema.safeParse(diagram).success, template.templateId).toBe(true);
          expect(failing(validateDiagram(diagram)), template.templateId).toEqual([]);
        }
      }
    }
  });

  it("labels the cone with the same values the prose states", () => {
    const template = JUNE_2019_PAPER_1_TEMPLATES.find((entry) => entry.sourceQuestionNumber === 15)!;
    for (let index = 0; index < 20; index += 1) {
      const { unit, diagrams } = figures(template, `cone-${index}`);
      const { radius, height } = unit.parameters as { radius: number; height: number };
      const labels = diagramLabels(diagrams[0]!).map((label) => label.replace(/\s+/gu, ""));
      expect(labels).toContain(`${2 * radius}cm`);
      expect(labels).toContain(`${height}cm`);
    }
  });

  it("keeps calibrated figures calibrated", () => {
    for (const template of JUNE_2019_PAPER_1_TEMPLATES) {
      const { diagrams } = figures(template, "calibration");
      for (const diagram of diagrams) expect(["calibrated", "not-to-scale"]).toContain(diagram.scale);
    }
    const graph = JUNE_2019_PAPER_1_TEMPLATES.find((entry) => entry.sourceQuestionNumber === 10)!;
    expect(figures(graph, "calibration").diagrams[0]!.scale).toBe("calibrated");
  });
});
