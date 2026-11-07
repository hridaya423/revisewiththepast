import { answerLine, display, frac, fracR, M, math, p, paren, sqrt, sup } from "../../../domain/content";
import { R, formatDecimal, isTerminatingDecimal } from "../../../domain/rational";
import { check } from "../../../domain/types";
import { PILOT_REVIEW, criterion, defineTemplate, gcd, pilotUnitKey, questionDocument, questionPart, schemePart } from "./common";

type Params = { k: number; p: number; q: number };

function derive({ k, p: numerator, q }: Params) {
  const a = numerator - k * q;
  const b = numerator * q;
  const positiveRoot = R(numerator, k);
  const negativeRoot = R(-q);
  return { a, b, positiveRoot, negativeRoot };
}

const showRoot = (value: ReturnType<typeof R>) => (isTerminatingDecimal(value) ? formatDecimal(value).replace("-", "−") : value.toExact().replace("-", "−"));

export const q17RatioQuadratic = defineTemplate<Params, ReturnType<typeof derive>>({
  templateId: "edexcel-1ma1h-2019-06-q17-ratio-quadratic",
  revision: 1,
  sourceUnitKey: pilotUnitKey(17),
  sourceQuestionNumber: 17,
  topics: ["algebra", "ratio", "quadratic equations"],
  structure: [{ partId: "", marks: 4 }],
  sourceParameters: { k: 2, p: 5, q: 1 },
  review: PILOT_REVIEW,
  sample: (rng) => ({ k: rng.int(2, 4), p: rng.int(3, 15), q: rng.int(1, 4) }),
  constraints: ({ k, p: numerator, q }) => {
    const a = numerator - k * q;
    const b = numerator * q;
    const violations: string[] = [];
    if (gcd(numerator, k) !== 1) violations.push("fractional-root");
    if (a < 1 || a > 12) violations.push("linear-coefficient-range");
    if (b > 40) violations.push("constant-range");
    if (R(numerator, k).eq(R(q))) violations.push("roots-differ-in-size");
    return violations;
  },
  derive,
  buildQuestion: ({ k }, { a, b }, context) => questionDocument(context.questionNumber, [p("Given that"), display(sup("x", 2), " : ", paren(`${a === 1 ? "" : a}x + ${b}`), ` = 1 : ${k}`)], [
    questionPart("", { prompt: [p("find the possible values of ", math("x"), ".")], marks: 4, working: 280, answer: answerLine() }),
  ]),
  solve: ({ k, p: numerator, q }, derived) => {
    const { a, b } = derived;
    const ax = `${a === 1 ? "" : a}x`;
    const quadratic = M(`${k}`, sup("x", 2), ` − ${ax} − ${b}`);
    const factor = M(paren(`${k}x − ${numerator}`), paren(`x + ${q}`));
    const discriminant = a * a + 4 * k * b;
    return { parts: [schemePart({
      partId: "",
      marks: 4,
      answer: [`${showRoot(derived.negativeRoot)}, ${showRoot(derived.positiveRoot)}`],
      criteria: [
        criterion("p1", "P1", ["for process to form an equation, eg ", math(frac(sup("x", 2), `${ax} + ${b}`), " = ", frac(1, k)), " or ", math(`${k}`, sup("x", 2), ` = ${ax} + ${b}`)]),
        criterion("p2", "P1", ["for writing in a suitable form ready for solution, eg ", math(quadratic, " (= 0)"), " or ", math(`−${k}`, sup("x", 2), ` + ${ax} + ${b} (= 0)`)], { dependsOn: ["p1"] }),
        criterion("p3", "P1", ["(dep 1st P1) for process to solve quadratic equation of form ", math("a", sup("x", 2), " + bx + c (= 0)"), ", eg ", math(factor, " (= 0)"), " or ", math(frac(M(`${a} ± `, sqrt(M(sup(paren(`−${a}`), 2), ` − 4 × ${k} × −${b}`))), `2 × ${k}`))], { dependsOn: ["p1"] }),
        criterion("a1", "A1", [`for ${showRoot(derived.negativeRoot)}, ${showRoot(derived.positiveRoot)} oe`], { dependsOn: ["p3"] }),
      ],
      working: [
        display(frac(sup("x", 2), `${ax} + ${b}`), " = ", frac(1, k)),
        display(`${k}`, sup("x", 2), ` = ${ax} + ${b}`),
        display(quadratic, " = 0"),
        display(factor, " = 0"),
        p(math("x = ", fracR(derived.positiveRoot)), " or ", math(`x = −${q}`)),
        p(`Check: the discriminant is ${discriminant} = ${Math.sqrt(discriminant)}², so the roots are rational.`),
      ],
    })] };
  },
  verify: ({ k }, derived) => {
    const residual = (x: ReturnType<typeof R>) => R(k).mul(x).mul(x).sub(R(derived.a).mul(x)).sub(R(derived.b));
    const ratioHolds = (x: ReturnType<typeof R>) => x.mul(x).mul(R(k)).eq(R(derived.a).mul(x).add(R(derived.b))) && !R(derived.a).mul(x).add(R(derived.b)).isZero();
    const discriminant = derived.a * derived.a + 4 * k * derived.b;
    return [
      check("roots-satisfy-quadratic", residual(derived.positiveRoot).isZero() && residual(derived.negativeRoot).isZero()),
      check("roots-satisfy-ratio", ratioHolds(derived.positiveRoot) && ratioHolds(derived.negativeRoot)),
      check("discriminant-square", Number.isInteger(Math.sqrt(discriminant))),
      check("one-root-non-integer", !derived.positiveRoot.isInteger()),
    ];
  },
});
