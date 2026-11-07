import { answerLine, display, frac, fracR, math, p, paren, sqrt, sup } from "../../../domain/content";
import { R, Rational, formatDecimal, isTerminatingDecimal, roundToSignificantFigures } from "../../../domain/rational";
import { check } from "../../../domain/types";
import { PILOT_REVIEW, criterion, defineTemplate, pilotUnitKey, questionDocument, questionPart, schemePart } from "./common";

type Params = { root: number; aOffsetTenths: number; bOffsetTenths: number; mantissaTenths: number; power: number; base: number; negativeExponent: number };

const roundOneFigure = (value: Rational) => roundToSignificantFigures(value, 1);

/** (mantissa ÷ 10)^power pairs whose value has exactly three integer digits, like the source's 2.3^6 = 148. */
const POWER_PAIRS = Array.from({ length: 29 }, (_, index) => index + 11)
  .filter((mantissaTenths) => mantissaTenths % 10 !== 0)
  .flatMap((mantissaTenths) => [3, 4, 5, 6].map((power) => ({ mantissaTenths, power })))
  .filter(({ mantissaTenths, power }) => {
    const value = R(mantissaTenths, 10).pow(power);
    return !value.lt(R(100)) && value.lt(R(9995, 10));
  });

function derive(parameters: Params) {
  const a = R(parameters.root * parameters.root * 10 + parameters.aOffsetTenths, 10);
  const b = R(1000 + parameters.bOffsetTenths, 10);
  const aRounded = roundOneFigure(a);
  const bRounded = roundOneFigure(b);
  const product = aRounded.mul(bRounded).toNumber();
  const square = parameters.root * parameters.root * bRounded.toNumber();
  const estimates = [Math.sqrt(product), Math.sqrt(square)];
  const low = Math.floor(Math.min(...estimates)) - 2;
  const high = Math.ceil(Math.max(...estimates)) + 1;
  const mantissa = R(parameters.mantissaTenths, 10);
  const smaller = R(parameters.mantissaTenths, 100);
  const exact = mantissa.pow(parameters.power);
  const given = roundToSignificantFigures(exact, 3);
  const answerB = roundToSignificantFigures(smaller.pow(parameters.power), 3);
  const answerC = R(1).div(R(parameters.base).pow(parameters.negativeExponent));
  return { a, b, aRounded, bRounded, low, high, trueValue: Math.sqrt(a.toNumber() * b.toNumber()), mantissa, smaller, exact, given, answerB, answerC };
}

export const q08EstimationPowers = defineTemplate<Params, ReturnType<typeof derive>>({
  templateId: "edexcel-1ma1h-2019-06-q08-estimation-powers",
  revision: 2,
  sourceUnitKey: pilotUnitKey(8),
  sourceQuestionNumber: 8,
  topics: ["number", "estimation", "indices", "significant figures"],
  structure: [{ partId: "a", marks: 2 }, { partId: "b", marks: 1 }, { partId: "c", marks: 1 }],
  sourceParameters: { root: 8, aOffsetTenths: -5, bOffsetTenths: 17, mantissaTenths: 23, power: 6, base: 5, negativeExponent: 2 },
  review: PILOT_REVIEW,
  sample: (rng) => ({
    ...rng.pick(POWER_PAIRS),
    root: rng.int(6, 9),
    aOffsetTenths: rng.pick([-9, -8, -7, -6, -5, -4, -3, 3, 4, 5, 6, 7, 8, 9]),
    bOffsetTenths: rng.pick([-27, -23, -18, -14, -9, -6, 6, 9, 13, 17, 22, 26]),
    base: rng.int(2, 10),
    negativeExponent: rng.int(2, 3),
  }),
  constraints: (parameters) => {
    const derived = derive(parameters);
    const violations: string[] = [];
    if (parameters.mantissaTenths % 10 === 0) violations.push("mantissa-not-integer");
    if (derived.exact.lt(R(100)) || !derived.exact.lt(R(9995, 10))) violations.push("given-value-three-integer-digits");
    if (derived.aRounded.eq(R(parameters.root * parameters.root))) violations.push("one-figure-rounding-differs-from-square");
    if (parameters.base < 2 || R(parameters.base).pow(parameters.negativeExponent).gt(R(1000))) violations.push("negative-power-size");
    if (derived.trueValue < derived.low || derived.trueValue > derived.high) violations.push("range-contains-true-value");
    return violations;
  },
  unchangedParts: (parameters) => [
    ...(parameters.root === 8 && parameters.aOffsetTenths === -5 && parameters.bOffsetTenths === 17 ? ["a"] : []),
    ...(parameters.mantissaTenths === 23 && parameters.power === 6 ? ["b"] : []),
    ...(parameters.base === 5 && parameters.negativeExponent === 2 ? ["c"] : []),
  ],
  derive,
  buildQuestion: (parameters, derived, context) => questionDocument(context.questionNumber, [], [
    questionPart("a", { prompt: [p("Work out an estimate for the value of ", math(sqrt(`${formatDecimal(derived.a)} × ${formatDecimal(derived.b)}`)))], marks: 2, working: 170, answer: answerLine() }),
    questionPart("b", {
      lead: [p(math(sup(paren(formatDecimal(derived.mantissa)), parameters.power)), ` = ${formatDecimal(derived.given)} correct to 3 significant figures.`)],
      prompt: [p("Find the value of ", math(sup(paren(formatDecimal(derived.smaller)), parameters.power)), " correct to 3 significant figures.")],
      marks: 1,
      working: 120,
      answer: answerLine(),
    }),
    questionPart("c", { prompt: [p("Find the value of ", math(sup(parameters.base, `−${parameters.negativeExponent}`)))], marks: 1, working: 70, answer: answerLine() }),
  ]),
  solve: (parameters, derived) => {
    const aText = formatDecimal(derived.a);
    const bText = formatDecimal(derived.b);
    const aRounded = formatDecimal(derived.aRounded);
    const bRounded = formatDecimal(derived.bRounded);
    const square = parameters.root * parameters.root;
    const productRounded = derived.aRounded.mul(derived.bRounded).toNumber();
    const terminating = isTerminatingDecimal(derived.answerC);
    return { parts: [
      schemePart({
        partId: "a",
        marks: 2,
        answer: [`${derived.low} to ${derived.high}`],
        criteria: [criterion("b2", "B2", [`for answer in the range ${derived.low} to ${derived.high}`])],
        partialCredit: [{ code: "B1", text: [`for ${aRounded} or ${bRounded} or ${productRounded} or ${square * derived.bRounded.toNumber()} or `, math(sqrt(`${square} × ${bRounded}`))] }],
        working: [
          display(sqrt(`${aText} × ${bText}`), " ≈ ", sqrt(`${square} × ${bRounded}`)),
          display(`= ${parameters.root} × ${Math.sqrt(derived.bRounded.toNumber())} = ${parameters.root * Math.sqrt(derived.bRounded.toNumber())}`),
          p(`Rounding to 1 significant figure gives √(${aRounded} × ${bRounded}) = √${productRounded} ≈ ${Math.sqrt(productRounded).toFixed(1)}, which is also in the accepted range.`),
        ],
      }),
      schemePart({
        partId: "b",
        marks: 1,
        answer: [formatDecimal(derived.answerB)],
        criteria: [criterion("b1", "B1", [`for ${formatDecimal(derived.answerB)} oe`])],
        accepted: [["Can use standard form."]],
        working: [
          display(sup(paren(formatDecimal(derived.smaller)), parameters.power), " = ", sup(paren(formatDecimal(derived.mantissa)), parameters.power), " × ", sup(10, `−${parameters.power}`)),
          display(`= ${formatDecimal(derived.given)} × `, sup(10, `−${parameters.power}`), ` = ${formatDecimal(derived.answerB)}`),
        ],
      }),
      schemePart({
        partId: "c",
        marks: 1,
        answer: [math(fracR(derived.answerC))],
        criteria: [criterion("b1", "B1", ["for ", math(fracR(derived.answerC)), ...(terminating ? [` or ${formatDecimal(derived.answerC)}`] : [])])],
        working: [display(sup(parameters.base, `−${parameters.negativeExponent}`), " = ", frac(1, sup(parameters.base, parameters.negativeExponent)), " = ", fracR(derived.answerC))],
      }),
    ] };
  },
  verify: (parameters, derived) => [
    check("estimate-range-contains-true-value", derived.trueValue >= derived.low && derived.trueValue <= derived.high),
    check("scaled-power-agrees", derived.answerB.eq(derived.given.mul(R(1).div(R(10).pow(parameters.power))))),
    check("scaled-power-numeric", Math.abs(derived.answerB.toNumber() - Math.pow(parameters.mantissaTenths / 100, parameters.power)) <= derived.answerB.toNumber() * 0.005),
    check("negative-power-reciprocal", derived.answerC.mul(R(parameters.base).pow(parameters.negativeExponent)).eq(R(1))),
  ],
  reveals: (_parameters, derived) => [{ partId: "b", tokens: [formatDecimal(derived.given)] }],
});
