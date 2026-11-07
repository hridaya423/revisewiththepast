import { bold, cell, display, math, p, table, answerLine } from "../../../domain/content";
import { R, formatDecimal } from "../../../domain/rational";
import { check } from "../../../domain/types";
import { PILOT_REVIEW, criterion, defineTemplate, pilotUnitKey, questionDocument, questionPart, schemePart } from "./common";

type Params = { blueTenths: number; total: number };

const decimal = formatDecimal;
function derive({ blueTenths, total }: Params) {
  const blue = R(blueTenths, 10);
  const red = R(1).sub(blue).div(R(2));
  return { blue, red, blueCount: (total * blueTenths) / 10, redCount: red.mul(R(total)).toNumber() };
}

export const q01ProbabilityTable = defineTemplate<Params, ReturnType<typeof derive>>({
  templateId: "edexcel-1ma1h-2019-06-q01-probability-table",
  revision: 1,
  sourceUnitKey: pilotUnitKey(1),
  sourceQuestionNumber: 1,
  topics: ["probability", "sample space"],
  structure: [{ partId: "a", marks: 2 }, { partId: "b", marks: 2 }],
  sourceParameters: { blueTenths: 2, total: 60 },
  review: PILOT_REVIEW,
  sample: (rng) => ({ blueTenths: rng.pick([1, 2, 3, 4, 6]), total: rng.int(4, 20) * 5 }),
  constraints: ({ blueTenths, total }) => {
    const violations: string[] = [];
    if ((total * blueTenths) % 10 !== 0) violations.push("blue-count-integer");
    if ((total * (10 - blueTenths)) % 20 !== 0) violations.push("red-count-integer");
    if (total < 20 || total > 100) violations.push("total-range");
    if ((total * blueTenths) / 10 < 4) violations.push("blue-count-too-small");
    return violations;
  },
  derive,
  buildQuestion: (_parameters, derived, context) => questionDocument(context.questionNumber, [
    p("There are only blue cubes, red cubes and yellow cubes in a box."),
    p("The table shows the probability of taking at random a blue cube from the box."),
    table([
      [cell(bold("Colour")), cell("blue"), cell("red"), cell("yellow")],
      [cell(bold("Probability")), cell(decimal(derived.blue)), [], []],
    ], { headerColumn: true, colWidth: 64, firstColWidth: 84 }),
    p("The number of red cubes in the box is the same as the number of yellow cubes in the box."),
  ], [
    questionPart("a", { prompt: [p("Complete the table.")], marks: 2, working: 96, answer: { kind: "none" } }),
    questionPart("b", {
      lead: [p(`There are ${derived.blueCount} blue cubes in the box.`)],
      prompt: [p("Work out the total number of cubes in the box.")],
      marks: 2,
      working: 150,
      answer: answerLine(),
    }),
  ]),
  solve: ({ blueTenths, total }, derived) => {
    const blue = decimal(derived.blue);
    const red = decimal(derived.red);
    const rest = decimal(R(1).sub(derived.blue));
    const reciprocal = R(10, blueTenths);
    return { parts: [
      schemePart({
        partId: "a",
        marks: 2,
        answer: [`red ${red}, yellow ${red}`],
        accepted: [["Accept any equivalent fraction or percentage, eg ", math(R(10 - blueTenths, 20)), ` or ${formatDecimal(derived.red.mul(R(100)))}%`]],
        criteria: [
          criterion("p1", "P1", [`for process to find sum of unknown probabilities, eg 1 − ${blue} (= ${rest})`]),
          criterion("a1", "A1", ["oe"], { dependsOn: ["p1"] }),
        ],
        partialCredit: [{ code: "P1", text: [`Award P1 for any two probabilities given that sum to ${rest}, eg in the table`] }],
        working: [
          display(`1 − ${blue} = ${rest}`),
          display(`${rest} ÷ 2 = ${red}`),
          p(`The red and yellow probabilities are both ${red}.`),
        ],
      }),
      schemePart({
        partId: "b",
        marks: 2,
        answer: [String(total)],
        criteria: [
          criterion("p1", "P1", [
            `for complete process to find total number of cubes, eg ${derived.blueCount} ÷ ${blue}`,
            ...(reciprocal.isInteger() ? [` or ${derived.blueCount} × ${reciprocal.toExact()}`] : []),
            ` OR states 0.1 = ${derived.blueCount / blueTenths}`,
          ]),
          criterion("a1", "A1", ["cao"], { dependsOn: ["p1"] }),
        ],
        working: [
          display(`${derived.blueCount} ÷ ${blue} = ${total}`),
          p(`There are ${total} cubes in the box.`),
        ],
      }),
    ] };
  },
  verify: ({ total }, derived) => [
    check("probabilities-sum-to-one", derived.blue.add(derived.red).add(derived.red).eq(R(1))),
    check("blue-count-consistent", derived.blue.mul(R(total)).eq(R(derived.blueCount))),
    check("red-and-yellow-counts-whole", Number.isInteger(derived.redCount) && derived.redCount > 0),
    check("red-differs-from-blue", !derived.red.eq(derived.blue)),
  ],
  reveals: (_parameters, derived) => [{ partId: "b", tokens: [String(derived.blueCount)] }],
});

