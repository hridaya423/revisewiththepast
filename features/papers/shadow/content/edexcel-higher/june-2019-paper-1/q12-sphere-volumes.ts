import { answerLine, bold, display, figure, frac, fracR, math, p, sup } from "../../../domain/content";
import { DiagramBuilder, validateDiagram } from "../../../domain/diagram";
import { R, formatDecimal } from "../../../domain/rational";
import { check } from "../../../domain/types";
import { PILOT_REVIEW, criterion, defineTemplate, pilotUnitKey, questionDocument, questionPart, schemePart } from "./common";

type Params = { first: number; second: number };

/** Percentages whose multiplier has a denominator of at most 10, so every product stays workable without a calculator. */
export const SPHERE_PERCENTS = [10, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90];

function derive({ first, second }: Params) {
  const firstMultiplier = R(100 + first, 100);
  const secondMultiplier = R(100 + second, 100);
  const combined = firstMultiplier.mul(secondMultiplier);
  const answer = R(1).div(combined);
  const baseRadius = 30;
  const radii = [baseRadius, baseRadius * Math.cbrt(firstMultiplier.toNumber()), baseRadius * Math.cbrt(combined.toNumber())];
  const builder = new DiagramBuilder(400, 2 * radii[2]! + 34);
  const centres = [80, 200, 320];
  const centreY = radii[2]! + 4;
  radii.forEach((radius, index) => {
    builder.circle(centres[index]!, centreY + radii[2]! - radius, radius, { fill: "sphere", w: 0.4 });
    builder.label(centres[index]!, 2 * radii[2]! + 26, [bold(["P", "Q", "R"][index]!)], { size: 11, anchor: "middle" });
  });
  const diagram = builder.build("not-to-scale", `Three spheres P, Q and R of increasing size.`);
  return { firstMultiplier, secondMultiplier, combined, answer, radii, diagram };
}

export const q12SphereVolumes = defineTemplate<Params, ReturnType<typeof derive>>({
  templateId: "edexcel-1ma1h-2019-06-q12-sphere-volumes",
  revision: 2,
  sourceUnitKey: pilotUnitKey(12),
  sourceQuestionNumber: 12,
  topics: ["ratio and proportion", "percentages", "fractions"],
  structure: [{ partId: "", marks: 3 }],
  sourceParameters: { first: 50, second: 50 },
  review: PILOT_REVIEW,
  sample: (rng) => ({ first: rng.pick(SPHERE_PERCENTS), second: rng.pick(SPHERE_PERCENTS) }),
  enumerate: () => SPHERE_PERCENTS.flatMap((first) => SPHERE_PERCENTS.map((second) => ({ first, second }))),
  constraints: ({ first, second }) => {
    const violations: string[] = [];
    if (![first, second].every((percent) => SPHERE_PERCENTS.includes(percent))) violations.push("percent-range");
    const answer = R(1).div(R(100 + first, 100).mul(R(100 + second, 100)));
    if (answer.isInteger()) violations.push("fraction-answer");
    if (answer.d > BigInt(400)) violations.push("denominator-workable");
    if (R(100, 100 + first + second).eq(answer)) violations.push("additive-trap-coincides");
    return violations;
  },
  derive,
  buildQuestion: ({ first, second }, derived, context) => questionDocument(context.questionNumber, [
    p("Here are three spheres."),
    figure(derived.diagram),
    p("The volume of sphere ", bold("Q"), ` is ${first}% more than the volume of sphere `, bold("P"), "."),
    p("The volume of sphere ", bold("R"), ` is ${second}% more than the volume of sphere `, bold("Q"), "."),
  ], [questionPart("", { prompt: [p("Find the volume of sphere ", bold("P"), " as a fraction of the volume of sphere ", bold("R"), ".")], marks: 3, working: 230, answer: answerLine() })]),
  solve: ({ first, second }, derived) => {
    const m = formatDecimal(derived.firstMultiplier);
    const n = formatDecimal(derived.secondMultiplier);
    const product = formatDecimal(derived.combined);
    const productExpression = first === second ? sup(m, 2) : `${m} × ${n}`;
    const reciprocal = R(1).div(derived.firstMultiplier);
    const hundredM = formatDecimal(derived.firstMultiplier.mul(R(100)));
    const hundredCombined = derived.combined.mul(R(100));
    const hundredM2 = formatDecimal(hundredCombined);
    const equivalent = frac((BigInt(100) * hundredCombined.d).toString(), hundredCombined.n.toString());
    return { parts: [schemePart({
      partId: "",
      marks: 3,
      answer: [math(fracR(derived.answer))],
      criteria: [
        criterion("p1", "P1", [`for process to find link between volume of Q and volume of P or between volume of R and volume of Q, eg ratio ${m} : 1 or Q = ${m}P or P = `, math(fracR(reciprocal)), `Q or two values in the ratio 1 : ${m} such as 100 and ${hundredM}`]),
        criterion("p2", "P1", ["for process to find link between volume of R and volume of P, eg ", math(productExpression, " : 1"), ` or two values in the ratio 1 : ${product} such as 100 and ${hundredM2}`], { dependsOn: ["p1"] }),
        criterion("a1", "A1", ["for ", math(fracR(derived.answer)), " oe fraction, eg ", math(equivalent)], { dependsOn: ["p2"] }),
      ],
      accepted: [[math(productExpression, " = ", fracR(derived.combined)), " is enough for P1P1."], ["Accept P = ", math(fracR(derived.answer)), "R"]],
      working: [
        p("Let the volume of P be 100 units."),
        display(`Q = 100 × ${m} = ${hundredM}`),
        display(`R = ${hundredM} × ${n} = ${hundredM2}`),
        display(frac("P", "R"), " = ", frac(100, hundredM2), " = ", fracR(derived.answer)),
      ],
    })] };
  },
  verify: ({ first, second }, derived) => {
    const [rp, rq, rr] = derived.radii as [number, number, number];
    const near = (value: number, percent: number) => Math.abs(value - (1 + percent / 100)) < 1e-9;
    return [
      ...validateDiagram(derived.diagram),
      check("diagram-volumes-follow-ratio", near((rq / rp) ** 3, first) && near((rr / rq) ** 3, second)),
      check("forward-percentage-check", derived.answer.mul(derived.firstMultiplier).mul(derived.secondMultiplier).eq(R(1))),
      check("answer-is-proper-fraction", derived.answer.lt(R(1)) && !derived.answer.isInteger()),
    ];
  },
});
