import { answerLines, display, figure, fracR, M, math, p, type MathInput } from "../../../domain/content";
import { clipLineToWindow, coordinateGrid, validateDiagram } from "../../../domain/diagram";
import { R, Rational, formatDecimal, roundToDecimalPlaces } from "../../../domain/rational";
import { check } from "../../../domain/types";
import { PILOT_REVIEW, criterion, defineTemplate, pilotUnitKey, questionDocument, questionPart, schemePart } from "./common";

type Params = { a1: number; b1: number; a2: number; b2: number; xNumerator: number; xDenominator: number; yNumerator: number; yDenominator: number };

const WINDOW = { xMin: -1, xMax: 3, yMin: -3, yMax: 1 };

function signedFraction(value: Rational): MathInput[] {
  return value.sign() < 0 ? ["−", fracR(value.abs())] : [fracR(value)];
}

function equationOne(parameters: Params, c1: Rational) {
  return M(`${parameters.a1}y + ${parameters.b1}x = `, signedFraction(c1));
}

function equationTwo(parameters: Params, c2: Rational) {
  return M(`${parameters.a2}y − ${parameters.b2}x = `, signedFraction(c2));
}

function readingRange(value: Rational) {
  const low = roundToDecimalPlaces(R(Number(value.mul(R(10)).floor()), 10), 1);
  return [low, low.add(R(1, 10))] as const;
}

function derive(parameters: Params) {
  const x = R(parameters.xNumerator, parameters.xDenominator);
  const y = R(parameters.yNumerator, parameters.yDenominator);
  const c1 = R(parameters.a1).mul(y).add(R(parameters.b1).mul(x));
  const c2 = R(parameters.a2).mul(y).sub(R(parameters.b2).mul(x));
  const grid = coordinateGrid({ ...WINDOW, unit: 56.7, minorPerUnit: 10, labelStep: 1, margin: { left: 24, right: 24, top: 20, bottom: 18 } });
  const segments = [
    clipLineToWindow(parameters.b1, parameters.a1, c1.toNumber(), WINDOW),
    clipLineToWindow(-parameters.b2, parameters.a2, c2.toNumber(), WINDOW),
  ];
  for (const [[x1, y1], [x2, y2]] of segments as Array<[[number, number], [number, number]]>) {
    const [px1, py1] = grid.toDiagram(x1, y1);
    const [px2, py2] = grid.toDiagram(x2, y2);
    grid.builder.line(px1, py1, px2, py2, { w: 1.1 });
  }
  const diagram = grid.builder.build("calibrated", `Graphs of two straight lines on a grid from x = −1 to 3 and y = −3 to 1, crossing near (${x.toNumber().toFixed(2)}, ${y.toNumber().toFixed(2)}).`);
  return { x, y, c1, c2, grid, diagram, segments, xRange: readingRange(x), yRange: readingRange(y) };
}

export const q10GraphicalSimultaneous = defineTemplate<Params, ReturnType<typeof derive>>({
  templateId: "edexcel-1ma1h-2019-06-q10-graphical-simultaneous",
  revision: 1,
  sourceUnitKey: pilotUnitKey(10),
  sourceQuestionNumber: 10,
  topics: ["algebra", "simultaneous equations", "graphs"],
  structure: [{ partId: "", marks: 2 }],
  sourceParameters: { a1: 3, b1: 2, a2: 2, b2: 3, xNumerator: 9, xDenominator: 4, yNumerator: -4, yDenominator: 3 },
  review: PILOT_REVIEW,
  sample: (rng) => {
    const xDenominator = rng.pick([4, 8]);
    const yDenominator = rng.pick([3, 6]);
    return {
      a1: rng.int(2, 4), b1: rng.int(1, 3), a2: rng.int(2, 4), b2: rng.int(2, 5),
      xNumerator: rng.int(Math.ceil(0.4 * xDenominator), Math.floor(2.6 * xDenominator)), xDenominator,
      yNumerator: rng.int(Math.ceil(-2.6 * yDenominator), Math.floor(0.6 * yDenominator)), yDenominator,
    };
  },
  constraints: (parameters) => {
    const violations: string[] = [];
    const x = R(parameters.xNumerator, parameters.xDenominator);
    const y = R(parameters.yNumerator, parameters.yDenominator);
    if (x.mul(R(10)).isInteger()) violations.push("x-between-grid-lines");
    if (y.mul(R(10)).isInteger()) violations.push("y-between-grid-lines");
    if (x.lt(R(2, 5)) || x.gt(R(13, 5))) violations.push("x-inside-window");
    if (y.lt(R(-13, 5)) || y.gt(R(3, 5))) violations.push("y-inside-window");
    const distanceToTenth = (value: Rational) => {
      const scaled = value.mul(R(10));
      const fraction = scaled.sub(R(Number(scaled.floor())));
      return Math.min(fraction.toNumber(), 1 - fraction.toNumber());
    };
    if (distanceToTenth(x) < 0.25 || distanceToTenth(y) < 0.25) violations.push("reading-not-ambiguous");
    const c1 = R(parameters.a1).mul(y).add(R(parameters.b1).mul(x));
    const c2 = R(parameters.a2).mul(y).sub(R(parameters.b2).mul(x));
    if (c1.isInteger() || c2.isInteger()) violations.push("constants-are-fractions");
    if (c1.d > BigInt(24) || c2.d > BigInt(24) || c1.abs().n > BigInt(200) || c2.abs().n > BigInt(200)) violations.push("constants-printable");
    const angle = Math.abs(Math.atan(-parameters.b1 / parameters.a1) - Math.atan(parameters.b2 / parameters.a2));
    if (angle < (35 * Math.PI) / 180) violations.push("lines-cross-clearly");
    try {
      clipLineToWindow(parameters.b1, parameters.a1, c1.toNumber(), WINDOW);
      clipLineToWindow(-parameters.b2, parameters.a2, c2.toNumber(), WINDOW);
    } catch {
      violations.push("lines-visible");
    }
    return violations;
  },
  derive,
  buildQuestion: (parameters, derived, context) => questionDocument(context.questionNumber, [
    p("The graphs with equations ", math(equationOne(parameters, derived.c1)), " and ", math(equationTwo(parameters, derived.c2)), " have been drawn on the grid below."),
    figure(derived.diagram),
  ], [
    questionPart("", {
      prompt: [
        p("Using the graphs, find estimates of the solutions of the simultaneous equations"),
        display(equationOne(parameters, derived.c1)),
        display(equationTwo(parameters, derived.c2)),
      ],
      marks: 2,
      working: 30,
      answer: answerLines({ prefix: [math("x ="), " "] }, { prefix: [math("y ="), " "] }),
    }),
  ]),
  solve: (_parameters, derived) => {
    const [xLow, xHigh] = derived.xRange;
    const [yLow, yHigh] = derived.yRange;
    const show = (value: Rational) => formatDecimal(value).replace("-", "−");
    return { parts: [schemePart({
      partId: "",
      marks: 2,
      answer: [math("x"), ` = ${show(xLow)} to ${show(xHigh)}, `, math("y"), ` = ${show(yHigh)} to ${show(yLow)}`],
      criteria: [
        criterion("m1", "M1", ["for recognition of use of intersection point, one of the solutions given, solutions reversed or solutions given as a coordinate"]),
        criterion("a1", "A1", [math("x"), ` given in the range ${show(xLow)} to ${show(xHigh)}, `, math("y"), ` given in the range ${show(yHigh)} to ${show(yLow)}`], { dependsOn: ["m1"] }),
      ],
      working: [
        p("The solution is where the two lines cross."),
        p("Reading from the graph: ", math("x"), ` ≈ ${formatDecimal(roundToDecimalPlaces(derived.x, 2))}, `, math("y"), ` ≈ ${show(roundToDecimalPlaces(derived.y, 2))}`),
        p("The exact solution is ", math("x = ", fracR(derived.x)), ", ", math("y = ", signedFraction(derived.y))),
      ],
    })] };
  },
  verify: (parameters, derived) => {
    const lineOne = R(parameters.a1).mul(derived.y).add(R(parameters.b1).mul(derived.x));
    const lineTwo = R(parameters.a2).mul(derived.y).sub(R(parameters.b2).mul(derived.x));
    const [px, py] = derived.grid.toDiagram(derived.x.toNumber(), derived.y.toNumber());
    const [rx, ry] = derived.grid.fromDiagram(px, py);
    const onLine = ([[x1, y1], [x2, y2]]: [number, number][], a: number, b: number, c: number) => Math.abs(a * x1 + b * y1 - c) < 1e-9 && Math.abs(a * x2 + b * y2 - c) < 1e-9;
    return [
      ...validateDiagram(derived.diagram),
      check("intersection-satisfies-both", lineOne.eq(derived.c1) && lineTwo.eq(derived.c2)),
      check("plotted-lines-match-equations", onLine(derived.segments[0]!, parameters.b1, parameters.a1, derived.c1.toNumber()) && onLine(derived.segments[1]!, -parameters.b2, parameters.a2, derived.c2.toNumber())),
      check("grid-calibration", Math.abs(rx - derived.x.toNumber()) < 1e-9 && Math.abs(ry - derived.y.toNumber()) < 1e-9),
      check("range-contains-solution", !derived.x.lt(derived.xRange[0]) && !derived.x.gt(derived.xRange[1]) && !derived.y.lt(derived.yRange[0]) && !derived.y.gt(derived.yRange[1])),
    ];
  },
});
