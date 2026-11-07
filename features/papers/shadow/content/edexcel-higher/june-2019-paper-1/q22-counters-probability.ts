import { answerLines, display, frac, italic, math, p } from "../../../domain/content";
import { R } from "../../../domain/rational";
import { check } from "../../../domain/types";
import { PILOT_REVIEW, criterion, defineTemplate, gcd, pilotUnitKey, questionDocument, questionPart, schemePart } from "./common";

type Params = { greenShare: number; parts: number; scale: number; addRed: number; addGreen: number };

function derive({ greenShare, parts, scale, addRed, addGreen }: Params) {
  const green = greenShare * scale;
  const red = (parts - greenShare) * scale;
  const first = R(green, red + green);
  const second = R(green + addGreen, red + green + addRed + addGreen);
  return { green, red, first, second };
}

export const q22CountersProbability = defineTemplate<Params, ReturnType<typeof derive>>({
  templateId: "edexcel-1ma1h-2019-06-q22-counters-probability",
  revision: 2,
  sourceUnitKey: pilotUnitKey(22),
  sourceQuestionNumber: 22,
  topics: ["probability", "algebra", "simultaneous equations"],
  structure: [{ partId: "", marks: 5 }],
  sourceParameters: { greenShare: 3, parts: 7, scale: 3, addRed: 2, addGreen: 3 },
  review: PILOT_REVIEW,
  sample: (rng) => {
    const parts = rng.int(3, 9);
    const shares = Array.from({ length: Math.min(6, parts - 1) }, (_, index) => index + 1).filter((share) => gcd(share, parts) === 1);
    return { greenShare: rng.pick(shares), parts, scale: rng.int(2, 6), addRed: rng.int(1, 5), addGreen: rng.int(1, 5) };
  },
  constraints: (parameters) => {
    const { green, red, first, second } = derive(parameters);
    const violations: string[] = [];
    if (parameters.greenShare >= parameters.parts) violations.push("share-less-than-whole");
    if (gcd(parameters.greenShare, parameters.parts) !== 1) violations.push("probability-in-lowest-terms");
    if (first.eq(second)) violations.push("probability-changes");
    if (second.d === BigInt(red + green + parameters.addRed + parameters.addGreen)) violations.push("second-probability-hides-total");
    if (red + green > 50) violations.push("bag-size");
    if (parameters.addRed === parameters.addGreen) violations.push("additions-differ");
    if (red === green) violations.push("colours-differ");
    return violations;
  },
  derive,
  buildQuestion: ({ addRed, addGreen }, derived, context) => questionDocument(context.questionNumber, [
    p("There are only ", italic("r"), " red counters and ", italic("g"), " green counters in a bag."),
    p("A counter is taken at random from the bag."),
    p("The probability that the counter is green is ", math(frac(derived.first.n.toString(), derived.first.d.toString()))),
    p("The counter is put back in the bag."),
    p(`${addRed} more red counter${addRed === 1 ? "" : "s"} and ${addGreen} more green counter${addGreen === 1 ? "" : "s"} are put in the bag.`),
    p("A counter is taken at random from the bag."),
    p("The probability that the counter is green is ", math(frac(derived.second.n.toString(), derived.second.d.toString()))),
  ], [questionPart("", {
    prompt: [p("Find the number of red counters and the number of green counters that were in the bag originally.")],
    marks: 5,
    working: 330,
    answer: answerLines({ prefix: ["red counters "] }, { prefix: ["green counters "] }),
  })]),
  solve: ({ greenShare, parts, addRed, addGreen }, derived) => {
    const a = derived.first.n.toString();
    const b = derived.first.d.toString();
    const c = derived.second.n.toString();
    const d = derived.second.d.toString();
    const redShare = parts - greenShare;
    const greenTerm = `${greenShare === 1 ? "" : greenShare}x + ${addGreen}`;
    const redTerm = `${redShare === 1 ? "" : redShare}x + ${addRed}`;
    const totalTerm = `${parts}x + ${addRed + addGreen}`;
    const left = Number(d) * greenShare;
    const right = Number(c) * parts;
    return { parts: [schemePart({
      partId: "",
      marks: 5,
      answer: [`${derived.red} red, ${derived.green} green`],
      branches: [
        { label: "Method 1", criteria: [
          criterion("p1", "P1", ["for process to find a relationship between ", italic("r"), " and ", italic("g"), ", eg ", math(frac("g", "r + g"), " = ", frac(a, b)), " or ", math(frac("g", "r"), " = ", frac(a, String(Number(b) - Number(a))))]),
          criterion("p2", "P1", ["for process to find a second relationship between ", italic("r"), " and ", italic("g"), ", eg ", math(frac(`g + ${addGreen}`, `r + ${addRed} + g + ${addGreen}`), " = ", frac(c, d)), " or ", math(frac(`g + ${addGreen}`, `r + ${addRed}`), " = ", frac(c, String(Number(d) - Number(c))))], { dependsOn: ["p1"] }),
          criterion("p3", "P1", ["(dep P2) for start to process of solving pair of equations, eg eliminates one variable from the equations or removes fractions from both equations"], { dependsOn: ["p2"] }),
          criterion("p4", "P1", ["(dep P3) for complete process to solve equations to find ", italic("g"), " or ", italic("r")], { dependsOn: ["p3"] }),
          criterion("a1", "A1", ["cao"], { dependsOn: ["p4"] }),
        ] },
        { label: "Method 2", criteria: [
          criterion("p1", "P1", [`for two of ${greenTerm}, ${redTerm} and ${totalTerm}`]),
          criterion("p2", "P1", ["for ", math(frac(greenTerm, totalTerm), " = ", frac(c, d))], { dependsOn: ["p1"] }),
          criterion("p3", "P1", ["(dep P2) for removing fractions from the equation, eg ", math(`${d}(${greenTerm}) = ${c}(${totalTerm})`), " or ", math(`${Number(d) * greenShare}x + ${Number(d) * addGreen} = ${Number(c) * parts}x + ${Number(c) * (addRed + addGreen)}`)], { dependsOn: ["p2"] }),
          criterion("p4", "P1", ["(dep P3) for complete process to solve ", math(`${d}(${greenTerm}) = ${c}(${totalTerm})`)], { dependsOn: ["p3"] }),
          criterion("a1", "A1", ["cao"], { dependsOn: ["p4"] }),
        ] },
      ],
      working: [
        p(`Since the probability of green is `, math(frac(a, b)), `, let there be ${greenShare === 1 ? "" : greenShare}x green and ${redShare === 1 ? "" : redShare}x red counters, ${parts}x in total.`),
        display(frac(greenTerm, totalTerm), " = ", frac(c, d)),
        display(`${d}(${greenTerm}) = ${c}(${totalTerm})`),
        display(`${left}x + ${Number(d) * addGreen} = ${right}x + ${Number(c) * (addRed + addGreen)}`),
        display(`x = ${derived.green / greenShare}`),
        p(`So there were ${derived.red} red counters and ${derived.green} green counters.`),
      ],
    })] };
  },
  verify: ({ addRed, addGreen }, derived) => {
    const { first, second } = derived;
    const [a, b, c, d] = [first.n, first.d, second.n, second.d].map(Number) as [number, number, number, number];
    const [a11, a12, rhs1] = [a, a - b, 0];
    const [a21, a22, rhs2] = [c, c - d, d * addGreen - c * (addRed + addGreen)];
    const determinant = a11 * a22 - a12 * a21;
    const solvedRed = (rhs1 * a22 - a12 * rhs2) / determinant;
    const solvedGreen = (a11 * rhs2 - a21 * rhs1) / determinant;
    return [
      check("system-has-unique-solution", determinant !== 0),
      check("cramer-solution-matches", Math.abs(solvedRed - derived.red) < 1e-9 && Math.abs(solvedGreen - derived.green) < 1e-9),
      check("first-probability-hides-total", first.d !== BigInt(derived.red + derived.green)),
      check("probabilities-proper", first.lt(R(1)) && second.lt(R(1))),
    ];
  },
});
