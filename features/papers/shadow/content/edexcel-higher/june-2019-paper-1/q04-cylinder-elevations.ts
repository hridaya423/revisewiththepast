import { figure, p } from "../../../domain/content";
import { DiagramBuilder, POINTS_PER_CM, validateDiagram } from "../../../domain/diagram";
import { R, formatDecimal } from "../../../domain/rational";
import { check } from "../../../domain/types";
import { PILOT_REVIEW, criterion, defineTemplate, pilotUnitKey, questionDocument, questionPart, schemePart } from "./common";

type Params = { diameter: number; height: number };

const CELL = POINTS_PER_CM;

function derive({ diameter, height }: Params) {
  const columns = 3 * diameter + 4;
  const rows = height + 3;
  const builder = new DiagramBuilder(columns * CELL + 1, rows * CELL + 1);
  for (let column = 0; column <= columns; column += 1) builder.line(column * CELL + 0.5, 0.5, column * CELL + 0.5, rows * CELL + 0.5, { w: 0.4, tone: "grid" });
  for (let row = 0; row <= rows; row += 1) builder.line(0.5, row * CELL + 0.5, columns * CELL + 0.5, row * CELL + 0.5, { w: 0.4, tone: "grid" });
  const top = 1 * CELL + 0.5;
  const bottom = (1 + height) * CELL + 0.5;
  const planLeft = 1 * CELL + 0.5;
  const frontLeft = (2 + diameter) * CELL + 0.5;
  const sideLeft = (3 + 2 * diameter) * CELL + 0.5;
  const radius = (diameter * CELL) / 2;
  builder.circle(planLeft + radius, bottom - radius, radius, { w: 1.1 });
  builder.rect(frontLeft, top, diameter * CELL, height * CELL, { lineWidth: 1.1 });
  builder.rect(sideLeft, top, diameter * CELL, height * CELL, { lineWidth: 1.1 });
  const labelY = bottom + CELL * 0.62;
  builder.label(planLeft + radius, labelY, "Plan", { size: 10, anchor: "middle" });
  builder.label(frontLeft + radius, labelY, diameter < 3 ? "Front" : "Front elevation", { size: 10, anchor: "middle" });
  builder.label(sideLeft + radius, labelY, diameter < 3 ? "Side" : "Side elevation", { size: 10, anchor: "middle" });
  const diagram = builder.build("calibrated", `A centimetre grid showing a plan view circle of diameter ${diameter} cm and front and side elevation rectangles ${diameter} cm wide and ${height} cm tall.`);
  return { diagram, radius: R(diameter, 2) };
}

export const q04CylinderElevations = defineTemplate<Params, ReturnType<typeof derive>>({
  templateId: "edexcel-1ma1h-2019-06-q04-cylinder-elevations",
  revision: 1,
  sourceUnitKey: pilotUnitKey(4),
  sourceQuestionNumber: 4,
  topics: ["geometry", "plans and elevations"],
  structure: [{ partId: "", marks: 2 }],
  sourceParameters: { diameter: 4, height: 5 },
  review: PILOT_REVIEW,
  sample: (rng) => ({ diameter: rng.int(2, 4), height: rng.int(3, 6) }),
  constraints: ({ diameter, height }) => {
    const violations: string[] = [];
    if (diameter === height) violations.push("elevations-must-not-be-square");
    if (diameter < 2 || diameter > 4) violations.push("diameter-fits-grid");
    if (height < 3 || height > 6) violations.push("height-range");
    return violations;
  },
  derive,
  enumerate: () => [2, 3, 4].flatMap((diameter) => [3, 4, 5, 6].filter((height) => height !== diameter).map((height) => ({ diameter, height }))),
  buildQuestion: (_parameters, derived, context) => questionDocument(context.questionNumber, [
    p("The diagram shows the plan, front elevation and side elevation of a solid shape, drawn on a centimetre grid."),
    figure(derived.diagram),
  ], [
    questionPart("", {
      prompt: [p("In the space below, draw a sketch of the solid shape."), p("Give the dimensions of the solid on your sketch.")],
      marks: 2,
      working: 280,
      answer: { kind: "none" },
    }),
  ]),
  solve: ({ diameter, height }, derived) => ({ parts: [schemePart({
    partId: "",
    marks: 2,
    answer: [`Sketch of a cylinder, radius ${formatDecimal(derived.radius)} cm (diameter ${diameter} cm), height ${height} cm`],
    criteria: [
      criterion("m1", "M1", ["for sketch of a cylinder"]),
      criterion("a1", "A1", ["sketch of cylinder, with dimensions shown"], { dependsOn: ["m1"] }),
    ],
    accepted: [[`${formatDecimal(derived.radius)} (cm) for radius or ${diameter} (cm) for diameter, and ${height} (cm) for height`], ["Hidden edges may or may not be shown."]],
    working: [
      p("The plan is a circle and both elevations are rectangles, so the solid is a cylinder."),
      p(`The circle has diameter ${diameter} cm, so the radius is ${formatDecimal(derived.radius)} cm.`),
      p(`The rectangles are ${height} cm tall, so the cylinder has height ${height} cm.`),
    ],
    manualMarking: true,
  })] }),
  verify: ({ diameter, height }, derived) => {
    const circle = derived.diagram.items.find((item) => item.d === "circle");
    const rects = derived.diagram.items.filter((item) => item.d === "rect");
    return [
      ...validateDiagram(derived.diagram),
      check("calibrated:plan-diameter", circle?.d === "circle" && Math.abs(circle.r * 2 - diameter * CELL) < 1e-6),
      check("calibrated:elevations", rects.length === 2 && rects.every((rect) => rect.d === "rect" && Math.abs(rect.w - diameter * CELL) < 1e-6 && Math.abs(rect.h - height * CELL) < 1e-6)),
      check("views-describe-one-cylinder", circle?.d === "circle" && rects.every((rect) => rect.d === "rect" && Math.abs(rect.w - circle.r * 2) < 1e-6)),
    ];
  },
});
