import { answerLine, display, frac, M, math, p, paren, sqrt, sup } from "../../../domain/content";
import { R } from "../../../domain/rational";
import { check } from "../../../domain/types";
import { PILOT_REVIEW, criterion, defineTemplate, pilotUnitKey, questionDocument, questionPart, schemePart } from "./common";

type Params = { base: number; first: number; second: number; power: number };

function derive({ base, first, second, power }: Params) {
  const left = first * first * base;
  const right = second * second * base;
  const coefficient = first + second;
  const half = (power - 1) / 2;
  const denominator = base ** ((power + 1) / 2);
  return { left, right, coefficient, half, denominator, powerCoefficient: base ** half };
}

const surdTerm = (multiplier: number, base: number) => (multiplier === 1 ? M(sqrt(base)) : M(String(multiplier), sqrt(base)));

export const q18Surds = defineTemplate<Params, ReturnType<typeof derive>>({
  templateId: "edexcel-1ma1h-2019-06-q18-surds",
  revision: 1,
  sourceUnitKey: pilotUnitKey(18),
  sourceQuestionNumber: 18,
  topics: ["number", "surds", "indices"],
  structure: [{ partId: "a", marks: 2 }, { partId: "b", marks: 3 }],
  sourceParameters: { base: 3, first: 1, second: 2, power: 7 },
  review: PILOT_REVIEW,
  sample: (rng) => ({ base: rng.pick([2, 3, 5, 6, 7]), first: rng.int(1, 2), second: rng.int(2, 4), power: rng.pick([3, 5, 7]) }),
  enumerate: () => [2, 3, 5, 6, 7].flatMap((base) => [1, 2].flatMap((first) => [2, 3, 4].flatMap((second) => [3, 5, 7].map((power) => ({ base, first, second, power }))))),
  constraints: (parameters) => {
    const { right, denominator } = derive(parameters);
    const violations: string[] = [];
    if (parameters.first >= parameters.second) violations.push("second-surd-larger");
    if (right > 100) violations.push("radicand-size");
    if (denominator > 700) violations.push("denominator-size");
    if (parameters.power % 2 === 0) violations.push("odd-power");
    return violations;
  },
  unchangedParts: ({ base, first, second, power }) => [
    ...(base === 3 && first === 1 && second === 2 ? ["a"] : []),
    ...(base === 3 && power === 7 ? ["b"] : []),
  ],
  derive,
  buildQuestion: ({ base, power }, derived, context) => questionDocument(context.questionNumber, [], [
    questionPart("a", { prompt: [p("Express ", math(sqrt(derived.left), " + ", sqrt(derived.right)), " in the form ", math("a", sqrt(base)), " where ", math("a"), " is an integer.")], marks: 2, working: 200, answer: answerLine() }),
    questionPart("b", { prompt: [p("Express ", math(sup(paren(frac(1, sqrt(base))), power)), " in the form ", math(frac(sqrt("b"), "c")), " where ", math("b"), " and ", math("c"), " are integers.")], marks: 3, working: 260, answer: answerLine() }),
  ]),
  solve: ({ base, first, second, power }, derived) => ({ parts: [
    schemePart({
      partId: "a",
      marks: 2,
      answer: [math(String(derived.coefficient), sqrt(base))],
      criteria: [
        criterion("m1", "M1", ["for working unambiguously with ", math(sqrt(derived.right)), ", eg ", math(sqrt(`${second * second} × ${base}`)), " or ", math(sqrt(second * second), " × ", sqrt(base)), " or ", math(surdTerm(second, base))]),
        criterion("a1", "A1", ["cao"], { dependsOn: ["m1"] }),
      ],
      working: [
        display(sqrt(derived.right), " = ", sqrt(`${second * second} × ${base}`), " = ", surdTerm(second, base)),
        ...(first > 1 ? [display(sqrt(derived.left), " = ", surdTerm(first, base))] : []),
        display(surdTerm(first, base), " + ", surdTerm(second, base), " = ", String(derived.coefficient), sqrt(base)),
      ],
    }),
    schemePart({
      partId: "b",
      marks: 3,
      answer: [math(frac(sqrt(base), derived.denominator))],
      criteria: [
        criterion("m1", "M1", ["for simplifying the power, eg ", math(sup(paren(sqrt(base)), power), ` = ${derived.powerCoefficient}`, sqrt(base))]),
        criterion("m2", "M1", ["for method to rationalise the denominator, eg multiplying by ", math(frac(sqrt(base), sqrt(base)))]),
        criterion("a1", "A1", ["for ", math(frac(sqrt(base), derived.denominator)), " or equivalent fraction in form ", math(frac(sqrt("b"), "c")), ", eg ", math(frac(sqrt(base ** power), base ** power))], { dependsOn: ["m1", "m2"] }),
      ],
      accepted: [["The rationalising step may be seen as the first step."]],
      working: [
        display(sup(paren(frac(1, sqrt(base))), power), " = ", frac(1, sup(paren(sqrt(base)), power)), " = ", frac(1, M(String(derived.powerCoefficient), sqrt(base)))),
        display("= ", frac(1, M(String(derived.powerCoefficient), sqrt(base))), " × ", frac(sqrt(base), sqrt(base)), " = ", frac(sqrt(base), derived.denominator)),
      ],
    }),
  ] }),
  verify: ({ base, first, second, power }, derived) => {
    const answerSquared = R(base, derived.denominator * derived.denominator);
    const target = R(1).div(R(base).pow(power));
    return [
      check("surd-sum-numeric", Math.abs(Math.sqrt(derived.left) + Math.sqrt(derived.right) - derived.coefficient * Math.sqrt(base)) < 1e-9),
      check("simplified-terms-exact", derived.left === first * first * base && derived.right === second * second * base),
      check("power-squared-exactly", answerSquared.eq(target)),
      check("power-numeric", Math.abs((1 / Math.sqrt(base)) ** power - Math.sqrt(base) / derived.denominator) < 1e-12),
    ];
  },
});
