import { answerLine, display, fn, frac, fracR, M, math, p, sqrt, type MathInput } from "../../../domain/content";
import { R, Rational } from "../../../domain/rational";
import { check } from "../../../domain/types";
import { PILOT_REVIEW, criterion, defineTemplate, pilotUnitKey, questionDocument, questionPart, schemePart } from "./common";

type Ratio = "sin" | "cos" | "tan";
type Params = { first: Ratio; firstAngle: number; second: Ratio; secondAngle: number };

/** Exact value as coefficient × √radicand, with radicand square-free. */
type Surd = { coefficient: Rational; radicand: number };

const EXACT: Record<string, Surd> = {
  "sin30": { coefficient: R(1, 2), radicand: 1 },
  "sin45": { coefficient: R(1, 2), radicand: 2 },
  "sin60": { coefficient: R(1, 2), radicand: 3 },
  "cos30": { coefficient: R(1, 2), radicand: 3 },
  "cos45": { coefficient: R(1, 2), radicand: 2 },
  "cos60": { coefficient: R(1, 2), radicand: 1 },
  "tan30": { coefficient: R(1, 3), radicand: 3 },
  "tan45": { coefficient: R(1), radicand: 1 },
  "tan60": { coefficient: R(1), radicand: 3 },
};

const PRINTED: Record<string, MathInput> = {
  "sin30": frac(1, 2), "sin45": frac(sqrt(2), 2), "sin60": frac(sqrt(3), 2),
  "cos30": frac(sqrt(3), 2), "cos45": frac(sqrt(2), 2), "cos60": frac(1, 2),
  "tan30": frac(1, sqrt(3)), "tan45": "1", "tan60": sqrt(3),
};


function multiply(left: Surd, right: Surd): Surd {
  const product = left.radicand * right.radicand;
  let coefficient = left.coefficient.mul(right.coefficient);
  let radicand = product;
  for (let factor = 2; factor * factor <= radicand; factor += 1) {
    while (radicand % (factor * factor) === 0) {
      radicand /= factor * factor;
      coefficient = coefficient.mul(R(factor));
    }
  }
  return { coefficient, radicand };
}

const key = (ratio: Ratio, angle: number) => `${ratio}${angle}`;

function violationsFor(parameters: Params) {
  const first = EXACT[key(parameters.first, parameters.firstAngle)];
  const second = EXACT[key(parameters.second, parameters.secondAngle)];
  if (!first || !second) return ["exact-value-known"];
  const violations: string[] = [];
  if (first.radicand === 1 || second.radicand === 1) violations.push("both-factors-irrational");
  if (parameters.first === parameters.second && parameters.firstAngle === parameters.secondAngle) violations.push("distinct-factors");
  const value = multiply(first, second);
  if (value.radicand !== 1) violations.push("product-rational");
  if (value.coefficient.isInteger()) violations.push("product-is-a-fraction");
  return violations;
}

const RATIOS: Ratio[] = ["sin", "cos", "tan"];
const ANGLES = [30, 45, 60];

/** Every ordered pair of GCSE exact values whose product is a non-integer rational. */
export const TRIG_DOMAIN: Params[] = RATIOS.flatMap((first) => ANGLES.flatMap((firstAngle) => RATIOS.flatMap((second) => ANGLES.map((secondAngle) => ({ first, firstAngle, second, secondAngle })))))
  .filter((parameters) => violationsFor(parameters).length === 0);

function derive({ first, firstAngle, second, secondAngle }: Params) {
  const value = multiply(EXACT[key(first, firstAngle)]!, EXACT[key(second, secondAngle)]!);
  return { value, expression: M(fn(first), `${firstAngle}° × `, fn(second), `${secondAngle}°`) };
}

export const q14ExactTrig = defineTemplate<Params, ReturnType<typeof derive>>({
  templateId: "edexcel-1ma1h-2019-06-q14-exact-trig",
  revision: 2,
  sourceUnitKey: pilotUnitKey(14),
  sourceQuestionNumber: 14,
  topics: ["trigonometry", "exact values", "surds"],
  structure: [{ partId: "", marks: 2 }],
  sourceParameters: { first: "tan", firstAngle: 30, second: "sin", secondAngle: 60 },
  review: PILOT_REVIEW,
  sample: (rng) => rng.pick(TRIG_DOMAIN),
  enumerate: () => TRIG_DOMAIN,
  constraints: violationsFor,
  derive,
  buildQuestion: (_parameters, derived, context) => questionDocument(context.questionNumber, [], [
    questionPart("", { prompt: [p("Find the exact value of ", math(derived.expression)), p("Give your answer in its simplest form.")], marks: 2, working: 250, answer: answerLine() }),
  ]),
  solve: ({ first, firstAngle, second, secondAngle }, derived) => {
    const left = PRINTED[key(first, firstAngle)]!;
    const right = PRINTED[key(second, secondAngle)]!;
    const decimal = derived.value.coefficient.mul(R(100)).isInteger() ? ` or ${derived.value.coefficient.toNumber()}` : "";
    return { parts: [schemePart({
      partId: "",
      marks: 2,
      answer: [math(fracR(derived.value.coefficient))],
      criteria: [
        criterion("m1", "M1", ["for ", math(left, " × ", right), " OR ", math(fn(first), `${firstAngle} = `, left), " oe or ", math(fn(second), `${secondAngle} = `, right)]),
        criterion("a1", "A1", ["for ", math(fracR(derived.value.coefficient)), decimal], { dependsOn: ["m1"] }),
      ],
      working: [display(derived.expression, " = ", left, " × ", right, " = ", fracR(derived.value.coefficient))],
    })] };
  },
  verify: ({ first, firstAngle, second, secondAngle }, derived) => {
    const evaluate = (ratio: Ratio, angle: number) => Math[ratio]((angle * Math.PI) / 180);
    const numeric = evaluate(first, firstAngle) * evaluate(second, secondAngle);
    return [
      check("floating-point-cross-check", Math.abs(numeric - derived.value.coefficient.toNumber() * Math.sqrt(derived.value.radicand)) < 1e-12),
      check("exact-values-agree-numerically", [first, second].every((ratio, index) => {
        const angle = index === 0 ? firstAngle : secondAngle;
        const exact = EXACT[key(ratio, angle)]!;
        return Math.abs(evaluate(ratio, angle) - exact.coefficient.toNumber() * Math.sqrt(exact.radicand)) < 1e-12;
      })),
    ];
  },
});
