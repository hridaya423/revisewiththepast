import { answerLine, display, frac, M, math, p, paren, space, sup, upright } from "../../../domain/content";
import { check } from "../../../domain/types";
import { PILOT_REVIEW, criterion, defineTemplate, gcd, pilotUnitKey, questionDocument, questionPart, schemePart } from "./common";

type Params = { a: number; b: number; c: number; m: number };

const signed = (value: number) => (value < 0 ? ` − ${-value}` : ` + ${value}`);
const term = (coefficient: number, symbol: string, first = false) => {
  const magnitude = Math.abs(coefficient) === 1 && symbol ? "" : String(Math.abs(coefficient));
  if (first) return `${coefficient < 0 ? "−" : ""}${magnitude}${symbol}`;
  return `${coefficient < 0 ? " − " : " + "}${magnitude}${symbol}`;
};

function derive({ a, b, c, m }: Params) {
  const square = m * a * a - a;
  const linear = 2 * m * a * b;
  const constant = m * b * b + m * c - a * c - b;
  return { square, linear, constant, inverseShift: -b };
}

const f = () => upright("f");
const g = () => upright("g");

export const q21Functions = defineTemplate<Params, ReturnType<typeof derive>>({
  templateId: "edexcel-1ma1h-2019-06-q21-functions",
  revision: 1,
  sourceUnitKey: pilotUnitKey(21),
  sourceQuestionNumber: 21,
  topics: ["algebra", "functions", "inverse functions", "composite functions"],
  structure: [{ partId: "a", marks: 2 }, { partId: "b", marks: 5 }],
  sourceParameters: { a: 3, b: -1, c: 4, m: 2 },
  review: PILOT_REVIEW,
  sample: (rng) => ({ a: rng.int(2, 5), b: rng.pick([-5, -4, -3, -2, -1, 1, 2, 3, 4, 5]), c: rng.int(1, 9), m: rng.pick([2, 2, 3]) }),
  constraints: (parameters) => {
    const { square, linear, constant } = derive(parameters);
    const violations: string[] = [];
    if (parameters.b === 0) violations.push("non-zero-shift");
    if (constant === 0 || linear === 0) violations.push("all-terms-present");
    if (gcd(gcd(square, linear), constant) !== 1) violations.push("equation-in-lowest-terms");
    if (Math.max(Math.abs(square), Math.abs(linear), Math.abs(constant)) > 99) violations.push("coefficient-size");
    return violations;
  },
  unchangedParts: ({ a, b, c, m }) => [
    ...(a === 3 && b === -1 ? ["a"] : []),
    ...(a === 3 && b === -1 && c === 4 && m === 2 ? ["b"] : []),
  ],
  derive,
  buildQuestion: ({ a, b, c, m }, derived, context) => {
    const multiplier = m === 1 ? "" : String(m);
    return questionDocument(context.questionNumber, [
      p("The functions f and g are such that"),
      display(f(), `(x) = ${a}x${signed(b)}`, space, space, space, upright("and"), space, space, space, g(), "(x) = ", sup("x", 2), signed(c)),
    ], [
      questionPart("a", { prompt: [p("Find ", math(sup(f(), "−1"), "(x)"))], marks: 2, working: 150, answer: answerLine([math(sup(f(), "−1"), "(x) ="), " "]) }),
      questionPart("b", {
        lead: [p("Given that ", math(f(), g(), `(x) = ${multiplier}`, g(), f(), "(x)"), ",")],
        prompt: [p("show that  ", math(`${term(derived.square, "", true)}`, sup("x", 2), `${term(derived.linear, "x")}${term(derived.constant, "")} = 0`))],
        marks: 5,
        working: 340,
        answer: { kind: "none" },
      }),
    ]);
  },
  solve: ({ a, b, c, m }, derived) => {
    const fx = M(`${a}x${signed(b)}`);
    const fg = M(`${a}`, paren(M(sup("x", 2), signed(c))), signed(b));
    const gf = M(sup(paren(fx), 2), signed(c));
    const expansionSquare = a * a;
    const expansionCross = a * b;
    const inverseNumerator = M(`x${signed(-b)}`);
    return { parts: [
      schemePart({
        partId: "a",
        marks: 2,
        answer: [math(frac(inverseNumerator, a))],
        criteria: [
          criterion("m1", "M1", ["first step to change the subject of ", math(`y = ${a}x${signed(b)}`), " or ", math(`x = ${a}y${signed(b)}`), ", eg ", math(`y${signed(-b)} = ${a}x`)]),
          criterion("a1", "A1", ["oe"], { dependsOn: ["m1"] }),
        ],
        working: [
          display(`y = ${a}x${signed(b)}`),
          display(`y${signed(-b)} = ${a}x`),
          display(sup(f(), "−1"), "(x) = ", frac(inverseNumerator, a)),
        ],
      }),
      schemePart({
        partId: "b",
        marks: 5,
        answer: ["Shown"],
        criteria: [
          criterion("m1", "M1", ["for method to find fg(x), eg ", math(f(), g(), "(x) = ", fg)]),
          criterion("m2", "M1", ["for method to find gf(x), eg ", math(g(), f(), "(x) = ", gf)]),
          criterion("m3", "M1", ["(dep on previous two M marks) for setting up equation, eg ", math(fg, ` = ${m}`, paren(gf, "[]"))], { dependsOn: ["m1", "m2"] }),
          criterion("m4", "M1", ["(dep 2nd M1) for correct expansion of ", math(sup(paren(fx), 2)), ", eg ", math(`${expansionSquare}`, sup("x", 2), `${term(expansionCross, "x")}${term(expansionCross, "x")}${signed(b * b)}`)], { dependsOn: ["m2"] }),
          criterion("c1", "C1", ["for ", math(`${term(derived.square, "", true)}`, sup("x", 2), `${term(derived.linear, "x")}${term(derived.constant, "")} = 0`), " from correct working"], { dependsOn: ["m3", "m4"] }),
        ],
        working: [
          display(f(), g(), "(x) = ", fg, " = ", `${a}`, sup("x", 2), signed(a * c + b)),
          display(g(), f(), "(x) = ", gf, " = ", `${expansionSquare}`, sup("x", 2), term(2 * expansionCross, "x"), signed(b * b + c)),
          display(`${a}`, sup("x", 2), signed(a * c + b), ` = ${m}`, paren(M(`${expansionSquare}`, sup("x", 2), term(2 * expansionCross, "x"), signed(b * b + c)))),
          display(`0 = ${term(derived.square, "", true)}`, sup("x", 2), `${term(derived.linear, "x")}${term(derived.constant, "")}`),
        ],
        dependsOnParts: [],
        manualMarking: true,
      }),
    ] };
  },
  verify: ({ a, b, c, m }, derived) => {
    const fFn = (x: number) => a * x + b;
    const gFn = (x: number) => x * x + c;
    const inverse = (x: number) => (x - b) / a;
    const samples = [-2, -1, 0, 1, 3, 4];
    return [
      check("inverse-undoes-function", samples.every((x) => Math.abs(inverse(fFn(x)) - x) < 1e-12)),
      check("show-that-identity", samples.every((x) => m * gFn(fFn(x)) - fFn(gFn(x)) === derived.square * x * x + derived.linear * x + derived.constant)),
      check("leading-coefficient-positive", derived.square > 0),
    ];
  },
});
