import { answerLines, display, italic, M, math, p, paren, sup } from "../../../domain/content";
import { check } from "../../../domain/types";
import { PILOT_REVIEW, criterion, defineTemplate, pilotUnitKey, questionDocument, questionPart, schemePart } from "./common";

type Params = { a: number; c: number };

function derive({ a, c }: Params) {
  return { b: a * a - c, linear: 2 * a };
}

const signedConstant = (value: number) => (value < 0 ? ` − ${-value}` : ` + ${value}`);
const fmt = (value: number) => (value < 0 ? `−${-value}` : String(value));

export const q19CompletingSquare = defineTemplate<Params, ReturnType<typeof derive>>({
  templateId: "edexcel-1ma1h-2019-06-q19-completing-square",
  revision: 1,
  sourceUnitKey: pilotUnitKey(19),
  sourceQuestionNumber: 19,
  topics: ["algebra", "completing the square", "turning points"],
  structure: [{ partId: "i", marks: 2 }, { partId: "ii", marks: 1 }],
  sourceParameters: { a: 3, c: 1 },
  review: PILOT_REVIEW,
  sample: (rng) => ({ a: rng.int(2, 7), c: rng.pick([-9, -7, -5, -3, -2, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) }),
  enumerate: () => [2, 3, 4, 5, 6, 7].flatMap((a) => [-9, -7, -5, -3, -2, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((c) => ({ a, c }))),
  constraints: ({ a, c }) => {
    const b = a * a - c;
    const violations: string[] = [];
    if (b <= 0) violations.push("b-positive");
    if (b === a) violations.push("a-and-b-differ");
    if (c === 0) violations.push("non-zero-constant");
    return violations;
  },
  derive,
  buildQuestion: ({ c }, derived, context) => {
    const quadratic = M(sup("x", 2), ` − ${derived.linear}x`, signedConstant(c));
    return questionDocument(context.questionNumber, [p("Given that  ", math(quadratic, " = ", sup(paren("x − a"), 2), " − b"), "  for all values of ", italic("x"), ",")], [
      questionPart("i", { prompt: [p("find the value of ", italic("a"), " and the value of ", italic("b"), ".")], marks: 2, working: 170, answer: answerLines({ prefix: [math("a ="), " "] }, { prefix: [math("b ="), " "] }) }),
      questionPart("ii", { prompt: [p("Hence write down the coordinates of the turning point on the graph of ", math("y = ", quadratic))], marks: 1, working: 40, answer: { kind: "coordinate" } }),
    ]);
  },
  solve: ({ a, c }, derived) => ({ parts: [
    schemePart({
      partId: "i",
      marks: 2,
      answer: [`${a}, ${derived.b}`],
      criteria: [
        criterion("m1", "M1", [`for a = ${a}, may be seen in working or as part of an expression, eg `, math(sup(paren(`x − ${a}`), 2), ` − ${a * a}`)]),
        criterion("a1", "A1", [`for a = ${a}, b = ${derived.b}`], { dependsOn: ["m1"] }),
      ],
      accepted: [[`${a * a} does not have to be seen for the M1 mark.`]],
      working: [
        display(sup("x", 2), ` − ${derived.linear}x`, signedConstant(c), " = ", sup(paren(`x − ${a}`), 2), ` − ${a * a}`, signedConstant(c)),
        display("= ", sup(paren(`x − ${a}`), 2), ` − ${derived.b}`),
      ],
    }),
    schemePart({
      partId: "ii",
      marks: 1,
      answer: [`(${a}, ${fmt(-derived.b)})`],
      criteria: [criterion("b1", "B1", [`for (${a}, ${fmt(-derived.b)}) or ft (i)`], { followThrough: true })],
      working: [p(`The minimum of `, math(sup(paren(`x − ${a}`), 2), ` − ${derived.b}`), ` is at x = ${a}, where y = ${fmt(-derived.b)}.`)],
      dependsOnParts: ["i"],
    }),
  ] }),
  verify: ({ a, c }, derived) => {
    const original = (x: number) => x * x - derived.linear * x + c;
    const completed = (x: number) => (x - a) ** 2 - derived.b;
    const samples = [-3, 0, 1, 2, 7];
    const vertexIsMinimum = original(a) < original(a - 1) && original(a) < original(a + 1);
    return [
      check("identity-holds-at-sample-points", samples.every((x) => original(x) === completed(x))),
      check("turning-point-is-minimum", vertexIsMinimum && original(a) === -derived.b),
    ];
  },
});
