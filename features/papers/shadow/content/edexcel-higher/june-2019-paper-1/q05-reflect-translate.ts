import { answerLines, bold, figure, italic, math, p, vec } from "../../../domain/content";
import { coordinateGrid, validateDiagram } from "../../../domain/diagram";
import { check } from "../../../domain/types";
import { PILOT_REVIEW, criterion, defineTemplate, pilotUnitKey, questionDocument, questionPart, schemePart } from "./common";

type Params = { x: number; y: number; up: number; across: number; c: number; d: number };
type Point = [number, number];

const fmt = (value: number) => (value < 0 ? `−${-value}` : String(value));
const point = ([x, y]: Point) => `(${fmt(x)}, ${fmt(y)})`;

function derive({ x, y, up, across, c, d }: Params) {
  const shapeA: Point[] = [[x, y], [x, y + up], [x + across, y]];
  const reflected = shapeA.map(([px, py]): Point => [px, -py]);
  const shapeB = reflected.map(([px, py]): Point => [px + c, py + d]);
  const grid = coordinateGrid({ xMin: -8, xMax: 8, yMin: -8, yMax: 8, unit: 24, minorPerUnit: 1, labelStep: 1, margin: { left: 22, right: 26, top: 22, bottom: 18 } });
  const centroid = (shape: Point[]): Point => [(shape[0]![0] * 2 + shape[2]![0]) / 3 + 0.05, (shape[0]![1] * 2 + shape[1]![1]) / 3];
  for (const [shape, name] of [[shapeA, "A"], [shapeB, "B"]] as const) {
    grid.builder.poly(shape.map(([px, py]) => grid.toDiagram(px, py)), { fill: "shade", w: 1.1 });
    const [lx, ly] = grid.toDiagram(...centroid(shape));
    grid.builder.label(lx, ly + 4, [bold(name)], { size: 10, anchor: "middle" });
  }
  const diagram = grid.builder.build("calibrated", `Coordinate grid from −8 to 8 showing triangle A with vertices ${shapeA.map(point).join(", ")} and triangle B with vertices ${shapeB.map(point).join(", ")}.`);
  return { shapeA, reflected, shapeB, diagram, grid };
}

const inside = (shape: Point[], limit: number) => shape.every(([px, py]) => Math.abs(px) <= limit && Math.abs(py) <= limit);
const box = (shape: Point[]) => ({ x0: Math.min(...shape.map(([px]) => px)), x1: Math.max(...shape.map(([px]) => px)), y0: Math.min(...shape.map(([, py]) => py)), y1: Math.max(...shape.map(([, py]) => py)) });

export const q05ReflectTranslate = defineTemplate<Params, ReturnType<typeof derive>>({
  templateId: "edexcel-1ma1h-2019-06-q05-reflect-translate",
  revision: 2,
  sourceUnitKey: pilotUnitKey(5),
  sourceQuestionNumber: 5,
  topics: ["geometry", "transformations"],
  structure: [{ partId: "", marks: 3 }],
  sourceParameters: { x: 3, y: 2, up: 3, across: 2, c: -6, d: -1 },
  review: PILOT_REVIEW,
  sample: (rng) => {
    const up = rng.int(2, 4);
    return { x: rng.int(-6, 5), y: rng.int(1, 4), up, across: up === 2 ? 3 : up === 3 ? 2 : rng.int(2, 3), c: rng.pick([-8, -7, -6, -5, -4, -3, -2, 2, 3, 4, 5, 6, 7, 8]), d: rng.pick([-4, -3, -2, -1, 1, 2, 3, 4, 5, 6, 7]) };
  },
  constraints: (parameters) => {
    const { shapeA, reflected, shapeB } = derive(parameters);
    const violations: string[] = [];
    if (parameters.up === parameters.across) violations.push("legs-differ");
    if (parameters.c === 0 || parameters.d === 0) violations.push("translation-both-components");
    if (parameters.c === parameters.d) violations.push("swapped-answer-distinguishable");
    if (Math.abs(parameters.c) < 2) violations.push("translation-visible");
    if (!inside(shapeA, 7) || !inside(shapeB, 7)) violations.push("shapes-inside-grid");
    const a = box(shapeA);
    const b = box(shapeB);
    if (!(a.x1 < b.x0 || b.x1 < a.x0 || a.y1 < b.y0 || b.y1 < a.y0)) violations.push("shapes-overlap");
    const r = box(reflected);
    if (!(r.x1 < b.x0 || b.x1 < r.x0 || r.y1 < b.y0 || b.y1 < r.y0)) violations.push("reflection-overlaps-b");
    return violations;
  },
  derive,
  buildQuestion: (_parameters, derived, context) => questionDocument(context.questionNumber, [figure(derived.diagram)], [
    questionPart("", {
      prompt: [
        p("Shape ", bold("A"), " can be transformed to shape ", bold("B"), " by a reflection in the ", italic("x"), "-axis followed by a translation ", math(vec("c", "d"))),
        p("Find the value of ", italic("c"), " and the value of ", italic("d"), "."),
      ],
      marks: 3,
      working: 70,
      answer: answerLines({ prefix: [math("c ="), " "] }, { prefix: [math("d ="), " "] }),
    }),
  ]),
  solve: ({ c, d }, derived) => ({ parts: [schemePart({
    partId: "",
    marks: 3,
    answer: [math("c = "), fmt(c), ", ", math("d = "), fmt(d)],
    criteria: [
      criterion("m1", "M1", ["for reflection in ", italic("x"), "-axis shown on diagram"]),
      criterion("a1", "A1", ["for ", math("c = "), fmt(c), " or ", math("d = "), fmt(d)], { dependsOn: ["m1"] }),
      criterion("a2", "A1", ["for both ", math("c = "), fmt(c), " and ", math("d = "), fmt(d)], { dependsOn: ["a1"] }),
    ],
    accepted: [[`Reflected vertices ${derived.reflected.map(point).join(", ")}`], ["One correct value is M1A1 regardless of second value or diagram."]],
    specialCases: [{ code: "SC B2", text: ["for ", math("c = "), fmt(d), " and ", math("d = "), fmt(c)] }],
    working: [
      p(`Reflecting A in the x-axis gives the vertices ${derived.reflected.map(point).join(", ")}.`),
      p(`The vertex ${point(derived.reflected[0]!)} moves to ${point(derived.shapeB[0]!)}.`),
      p(`${fmt(derived.shapeB[0]![0])} − ${fmt(derived.reflected[0]![0])} = ${fmt(c)} and ${fmt(derived.shapeB[0]![1])} − ${fmt(derived.reflected[0]![1])} = ${fmt(d)}.`),
    ],
  })] }),
  verify: ({ c, d }, derived) => {
    const mapped = derived.shapeA.map(([px, py]) => [px + c, -py + d]);
    const roundTrip = derived.shapeB.every(([px, py]) => {
      const [dx, dy] = derived.grid.toDiagram(px, py);
      const [bx, by] = derived.grid.fromDiagram(dx, dy);
      return Math.abs(bx - px) < 1e-9 && Math.abs(by - py) < 1e-9;
    });
    return [
      ...validateDiagram(derived.diagram),
      check("transformation-maps-a-to-b", mapped.every(([px, py], index) => px === derived.shapeB[index]![0] && py === derived.shapeB[index]![1])),
      check("grid-calibration-round-trip", roundTrip),
      check("translation-alone-is-not-enough", derived.shapeA.some(([px, py], index) => px + c !== derived.shapeB[index]![0] || py + d !== derived.shapeB[index]![1])),
    ];
  },
});
