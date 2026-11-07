import { answerLine, display, frac, M, math, mixedR, p } from "../../../domain/content";
import { R } from "../../../domain/rational";
import { check } from "../../../domain/types";
import { PILOT_REVIEW, criterion, defineTemplate, gcd, pilotUnitKey, questionDocument, questionPart, schemePart } from "./common";

type Params = { w1: number; n1: number; d1: number; w2: number; n2: number; d2: number };

function derive({ w1, n1, d1, w2, n2, d2 }: Params) {
  const improper1 = w1 * d1 + n1;
  const improper2 = w2 * d2 + n2;
  const rawNumerator = improper1 * improper2;
  const rawDenominator = d1 * d2;
  const product = R(rawNumerator, rawDenominator);
  return { improper1, improper2, rawNumerator, rawDenominator, product, first: R(improper1, d1), second: R(improper2, d2) };
}

export const q09MixedNumbers = defineTemplate<Params, ReturnType<typeof derive>>({
  templateId: "edexcel-1ma1h-2019-06-q09-mixed-numbers",
  revision: 1,
  sourceUnitKey: pilotUnitKey(9),
  sourceQuestionNumber: 9,
  topics: ["number", "fractions"],
  structure: [{ partId: "", marks: 3 }],
  sourceParameters: { w1: 3, n1: 1, d1: 2, w2: 1, n2: 3, d2: 5 },
  review: PILOT_REVIEW,
  sample: (rng) => {
    const d1 = rng.int(2, 9);
    const d2 = rng.int(2, 9);
    return { w1: rng.int(2, 4), n1: rng.int(1, d1 - 1), d1, w2: rng.int(1, 3), n2: rng.int(1, d2 - 1), d2 };
  },
  constraints: (parameters) => {
    const { w1, n1, d1, w2, n2, d2 } = parameters;
    const { product, rawNumerator, rawDenominator } = derive(parameters);
    const violations: string[] = [];
    if (gcd(n1, d1) !== 1 || gcd(n2, d2) !== 1) violations.push("fractions-in-lowest-terms");
    if (d1 === d2) violations.push("different-denominators");
    if (product.isInteger()) violations.push("answer-not-whole");
    if (gcd(rawNumerator, rawDenominator) === 1) violations.push("answer-needs-simplifying");
    const whole = Number(product.floor());
    if (whole < 2 || whole > 15) violations.push("answer-size");
    if (R(w1 * w2).add(R(n1 * n2, d1 * d2)).eq(product)) violations.push("separate-multiplication-trap");
    if (rawDenominator > 60) violations.push("denominator-size");
    return violations;
  },
  derive,
  buildQuestion: ({ w1, n1, d1, w2, n2, d2 }, _derived, context) => questionDocument(context.questionNumber, [], [
    questionPart("", {
      prompt: [p("Work out  ", math(String(w1), frac(n1, d1), " × ", String(w2), frac(n2, d2))), p("Give your answer as a mixed number in its simplest form.")],
      marks: 3,
      working: 230,
      answer: answerLine(),
    }),
  ]),
  solve: ({ d1, d2 }, derived) => {
    const simplified = derived.product;
    const raw = M(frac(derived.rawNumerator, derived.rawDenominator));
    return { parts: [schemePart({
      partId: "",
      marks: 3,
      answer: [math(mixedR(simplified))],
      criteria: [
        criterion("m1", "M1", ["for writing as improper fractions with at least one correct, eg ", math(frac(derived.improper1, d1), " × ", frac(derived.improper2, d2)), " oe"]),
        criterion("m2", "M1", ["(dep) for multiplying improper fractions, eg ", math(raw), " or ", math(String(Math.floor(derived.rawNumerator / derived.rawDenominator)), frac(derived.rawNumerator % derived.rawDenominator, derived.rawDenominator)), " or ", math(frac(simplified.n.toString(), simplified.d.toString())), " oe"], { dependsOn: ["m1"] }),
        criterion("a1", "A1", ["cao"], { dependsOn: ["m2"] }),
      ],
      working: [
        display(frac(derived.improper1, d1), " × ", frac(derived.improper2, d2), " = ", raw),
        display("= ", frac(simplified.n.toString(), simplified.d.toString()), " = ", mixedR(simplified)),
      ],
    })] };
  },
  verify: ({ w1, n1, d1, w2, n2, d2 }, derived) => {
    const expanded = R(w1 * w2).add(R(w1 * n2, d2)).add(R(w2 * n1, d1)).add(R(n1 * n2, d1 * d2));
    return [
      check("distributive-expansion-agrees", expanded.eq(derived.product)),
      check("improper-conversion", derived.first.eq(R(w1).add(R(n1, d1))) && derived.second.eq(R(w2).add(R(n2, d2)))),
      check("decimal-cross-check", Math.abs(derived.product.toNumber() - (w1 + n1 / d1) * (w2 + n2 / d2)) < 1e-9),
    ];
  },
});
