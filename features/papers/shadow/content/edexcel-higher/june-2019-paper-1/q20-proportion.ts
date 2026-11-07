import { answerLine, display, frac, italic, M, math, p, sqrt } from "../../../domain/content";
import { R, formatDecimal, isTerminatingDecimal } from "../../../domain/rational";
import { check } from "../../../domain/types";
import { PILOT_REVIEW, criterion, defineTemplate, pilotUnitKey, questionDocument, questionPart, schemePart } from "./common";

type Params = { h: number; root: number; p: number };

function derive({ h, root, p: pValue }: Params) {
  const t = root * root;
  const inverseConstant = h * pValue;
  const directConstant = R(pValue, root);
  const numerator = h * root;
  return { t, inverseConstant, directConstant, numerator };
}

const showConstant = (value: ReturnType<typeof R>) => (isTerminatingDecimal(value) ? formatDecimal(value) : value.toExact());

export const q20Proportion = defineTemplate<Params, ReturnType<typeof derive>>({
  templateId: "edexcel-1ma1h-2019-06-q20-proportion",
  revision: 1,
  sourceUnitKey: pilotUnitKey(20),
  sourceQuestionNumber: 20,
  topics: ["ratio and proportion", "direct and inverse proportion"],
  structure: [{ partId: "", marks: 4 }],
  sourceParameters: { h: 10, root: 12, p: 6 },
  review: PILOT_REVIEW,
  sample: (rng) => ({ h: rng.int(2, 20), root: rng.int(4, 15), p: rng.int(2, 15) }),
  constraints: ({ h, root, p: pValue }) => {
    const directConstant = R(pValue, root);
    const violations: string[] = [];
    if (pValue === root) violations.push("direct-constant-not-one");
    if (!isTerminatingDecimal(directConstant) || directConstant.mul(R(100)).isInteger() === false) violations.push("direct-constant-terminates");
    if (h * pValue > 240) violations.push("inverse-constant-size");
    if (h * root > 400) violations.push("answer-size");
    if (new Set([h, pValue, root * root]).size < 3) violations.push("givens-distinct");
    return violations;
  },
  derive,
  buildQuestion: ({ h, p: pValue }, derived, context) => questionDocument(context.questionNumber, [
    p(italic("h"), " is inversely proportional to ", italic("p")),
    p(italic("p"), " is directly proportional to ", math(sqrt("t"))),
  ], [questionPart("", {
    prompt: [p("Given that  ", math(`h = ${h}`), "  and  ", math(`t = ${derived.t}`), "  when  ", math(`p = ${pValue}`)), p("find a formula for ", italic("h"), " in terms of ", italic("t"))],
    marks: 4,
    working: 300,
    answer: answerLine(),
  })]),
  solve: ({ h, root, p: pValue }, derived) => {
    const k = derived.inverseConstant;
    const K = showConstant(derived.directConstant);
    return { parts: [schemePart({
      partId: "",
      marks: 4,
      answer: [math("h = ", frac(derived.numerator, sqrt("t")))],
      criteria: [
        criterion("p1", "P1", ["for setting up a proportional relationship between ", italic("h"), " and ", italic("p"), ", eg ", math("h ∝ ", frac(1, "p")), " or ", math("h = ", frac("k", "p")), " OR a proportional relationship between ", italic("p"), " and ", italic("t"), ", eg ", math("p ∝ ", sqrt("t")), " or ", math("p = K", sqrt("t"))]),
        criterion("p2", "P1", ["for process to substitute at least 2 values, eg ", math(`${h} = `, frac("k", pValue)), ` (k = ${k}) or `, math(`${pValue} = K`, sqrt(derived.t)), ` (K = ${K})`], { dependsOn: ["p1"] }),
        criterion("p3", "P1", ["for full process leading to ", math("h = ", frac(k, "p")), " oe and ", math(`p = ${K}`, sqrt("t")), " oe"], { dependsOn: ["p2"] }),
        criterion("a1", "A1", [math("h = ", frac(derived.numerator, sqrt("t"))), " oe, eg ", math("h = ", frac(M(String(derived.numerator), sqrt("t")), "t")), " or ", math("h = ", frac(k, M(K, sqrt("t"))))], { dependsOn: ["p3"] }),
      ],
      accepted: [["Condone the use of ∝ instead of = for the first two P marks."], ["The relationship may be implied by substitution."], ["Both constants must come from a correct process; the formula does not need to be in its simplest form."]],
      working: [
        p(math("h = ", frac("k", "p")), " and ", math(`${h} = `, frac("k", pValue)), ", so ", math(`k = ${k}`)),
        p(math("p = K", sqrt("t")), " and ", math(`${pValue} = K`, sqrt(derived.t), ` = ${root}K`), ", so ", math(`K = ${K}`)),
        display("h = ", frac(k, M(K, sqrt("t"))), " = ", frac(derived.numerator, sqrt("t"))),
      ],
    })] };
  },
  verify: ({ h, root, p: pValue }, derived) => {
    const formula = (t: number) => derived.numerator / Math.sqrt(t);
    const pOf = (t: number) => derived.directConstant.toNumber() * Math.sqrt(t);
    return [
      check("formula-matches-given-values", Math.abs(formula(derived.t) - h) < 1e-12 && Math.abs(pOf(derived.t) - pValue) < 1e-12),
      check("inverse-proportion-holds", [4, 9, 50, 400].every((t) => Math.abs(formula(t) * pOf(t) - derived.inverseConstant) < 1e-9)),
      check("root-is-integer", Number.isInteger(Math.sqrt(derived.t)) && Math.sqrt(derived.t) === root),
    ];
  },
});
