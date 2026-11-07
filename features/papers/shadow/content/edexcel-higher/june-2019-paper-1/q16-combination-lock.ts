import { answerLine, display, figure, math, p, sup } from "../../../domain/content";
import { DiagramBuilder, validateDiagram } from "../../../domain/diagram";
import { check } from "../../../domain/types";
import { PILOT_REVIEW, criterion, defineTemplate, numberWord, pilotUnitKey, questionDocument, questionPart, schemePart } from "./common";

type Params = { dials: number; highest: number; example: number[] };

function derive({ dials, highest, example }: Params) {
  const total = highest ** dials;
  let different = 1;
  for (let index = 0; index < dials; index += 1) different *= highest - index;

  const builder = new DiagramBuilder(200, 70 + dials * 30);
  const bodyTop = 58;
  const bodyHeight = dials * 30 + 8;
  builder.poly([[64, bodyTop], [64, 30], [72, 14], [100, 6], [128, 14], [136, 30], [136, bodyTop]], { closed: false, w: 4 });
  builder.rect(24, bodyTop, 152, bodyHeight, { fill: "light", radius: 6, lineWidth: 0.9 });
  example.forEach((digit, index) => {
    const y = bodyTop + 6 + index * 30;
    builder.rect(56, y, 88, 22, { fill: "white", radius: 3, lineWidth: 0.7 });
    const previous = digit === 1 ? highest : digit - 1;
    const next = digit === highest ? 1 : digit + 1;
    builder.label(70, y + 15, String(previous), { size: 9, anchor: "middle" });
    builder.rect(90, y + 2, 20, 18, { fill: "white", lineWidth: 1 });
    builder.label(100, y + 15, String(digit), { size: 11, anchor: "middle", bold: true });
    builder.label(130, y + 15, String(next), { size: 9, anchor: "middle" });
  });
  const diagram = builder.build("not-to-scale", `A combination lock with ${dials} dials showing ${example.join("")}.`);
  return { total, different, diagram, exampleText: example.join("") };
}

export const q16CombinationLock = defineTemplate<Params, ReturnType<typeof derive>>({
  templateId: "edexcel-1ma1h-2019-06-q16-combination-lock",
  revision: 1,
  sourceUnitKey: pilotUnitKey(16),
  sourceQuestionNumber: 16,
  topics: ["probability", "counting strategies"],
  structure: [{ partId: "a", marks: 2 }, { partId: "b", marks: 2 }],
  sourceParameters: { dials: 3, highest: 5, example: [5, 5, 3] },
  review: PILOT_REVIEW,
  sample: (rng) => {
    const dials = rng.pick([3, 3, 4]);
    const highest = rng.int(4, 9);
    const example = Array.from({ length: dials }, () => rng.int(1, highest));
    return { dials, highest, example };
  },
  constraints: ({ dials, highest, example }) => {
    const violations: string[] = [];
    if (example.length !== dials) violations.push("example-matches-dials");
    if (example.some((digit) => digit < 1 || digit > highest)) violations.push("example-digits-valid");
    if (new Set(example).size === dials) violations.push("example-has-repeat");
    if (highest < dials + 1) violations.push("enough-digits");
    if (highest ** dials > 7000) violations.push("total-size");
    return violations;
  },
  unchangedParts: ({ dials, highest }) => (dials === 3 && highest === 5 ? ["a", "b"] : []),
  derive,
  buildQuestion: ({ dials, highest }, derived, context) => {
    const word = numberWord(dials);
    return questionDocument(context.questionNumber, [
      p(`There are ${word} dials on a combination lock.`),
      p(`Each dial can be set to one of the numbers ${Array.from({ length: highest }, (_, index) => index + 1).join(", ")}`),
      p(`The ${word} digit number ${derived.exampleText} is one way the dials can be set, as shown in the diagram.`),
      figure(derived.diagram),
    ], [
      questionPart("a", { prompt: [p(`Work out the number of different ${word} digit numbers that can be set for the combination lock.`)], marks: 2, working: 200, answer: answerLine() }),
      questionPart("b", { prompt: [p(`How many of the possible ${word} digit numbers have ${word} different digits?`)], marks: 2, working: 200, answer: answerLine() }),
    ]);
  },
  solve: ({ dials, highest }, derived) => {
    const factors = Array.from({ length: dials }, (_, index) => highest - index).join(" × ");
    return { parts: [
      schemePart({
        partId: "a",
        marks: 2,
        answer: [String(derived.total)],
        criteria: [
          criterion("m1", "M1", ["for method to find the number of combinations, eg ", math(sup(highest, dials)), " or ", math(sup(highest, dials), " − 1")]),
          criterion("a1", "A1", [`for ${derived.total} or ${derived.total - 1}`], { dependsOn: ["m1"] }),
        ],
        working: [display(sup(highest, dials), ` = ${Array.from({ length: dials }, () => highest).join(" × ")} = ${derived.total}`)],
      }),
      schemePart({
        partId: "b",
        marks: 2,
        answer: [String(derived.different)],
        criteria: [
          criterion("m1", "M1", [`for method to find the number of combinations with ${numberWord(dials)} different digits, eg ${factors} or finds there are ${derived.total - derived.different} combinations that do not have ${numberWord(dials)} different digits`]),
          criterion("a1", "A1", ["cao"], { dependsOn: ["m1"] }),
        ],
        working: [
          p(`The first dial has ${highest} choices, the next ${highest - 1}, and so on.`),
          display(`${factors} = ${derived.different}`),
        ],
      }),
    ] };
  },
  verify: ({ dials, highest }, derived) => {
    let all = 0;
    let distinct = 0;
    const visit = (depth: number, used: number[]) => {
      if (depth === dials) {
        all += 1;
        if (new Set(used).size === dials) distinct += 1;
        return;
      }
      for (let digit = 1; digit <= highest; digit += 1) visit(depth + 1, [...used, digit]);
    };
    visit(0, []);
    return [
      ...validateDiagram(derived.diagram),
      check("enumeration-total", all === derived.total),
      check("enumeration-distinct-digits", distinct === derived.different),
    ];
  },
});
