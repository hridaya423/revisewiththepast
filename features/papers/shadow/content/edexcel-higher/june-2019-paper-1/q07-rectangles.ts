import { answerLine, display, figure, fracR, italic, math, mixedR, p, sup, upright } from "../../../domain/content";
import { DiagramBuilder, validateDiagram } from "../../../domain/diagram";
import { R, formatDecimal } from "../../../domain/rational";
import { check } from "../../../domain/types";
import { PILOT_REVIEW, criterion, defineTemplate, pilotUnitKey, questionDocument, questionPart, schemePart } from "./common";

type Params = { qr: number; pqHalves: number; perimeter: number };

function derive({ qr, pqHalves, perimeter }: Params) {
  const pq = R(pqHalves, 2);
  const area = pq.mul(R(qr));
  const halfPerimeter = R(perimeter, 2);
  const ab = halfPerimeter.sub(pq);
  const builder = new DiagramBuilder(400, 200);
  const abcdWidth = 150;
  const abcdHeight = Math.max(36, Math.min(110, (abcdWidth * pq.toNumber()) / ab.toNumber()));
  const left = 60;
  const top = 34;
  builder.rect(left, top, abcdWidth, abcdHeight, { lineWidth: 0.9 });
  builder.label(left - 6, top - 6, [math("A")], { size: 11, anchor: "end" });
  builder.label(left + abcdWidth + 6, top - 6, [math("B")], { size: 11 });
  builder.label(left - 6, top + abcdHeight + 12, [math("D")], { size: 11, anchor: "end" });
  builder.label(left + abcdWidth + 6, top + abcdHeight + 12, [math("C")], { size: 11 });
  const pqrsHeight = 150;
  const pqrsWidth = Math.max(26, Math.min(90, (pqrsHeight * pq.toNumber()) / qr));
  const pLeft = 290;
  const pTop = 22;
  builder.rect(pLeft, pTop, pqrsWidth, pqrsHeight, { lineWidth: 0.9 });
  builder.label(pLeft - 6, pTop - 6, [math("P")], { size: 11, anchor: "end" });
  builder.label(pLeft + pqrsWidth + 6, pTop - 6, [math("Q")], { size: 11 });
  builder.label(pLeft - 6, pTop + pqrsHeight + 12, [math("S")], { size: 11, anchor: "end" });
  builder.label(pLeft + pqrsWidth + 6, pTop + pqrsHeight + 12, [math("R")], { size: 11 });
  const diagram = builder.build("not-to-scale", "Two rectangles: ABCD is wider than it is tall; PQRS is taller than it is wide.");
  return { pq, area, halfPerimeter, ab, diagram };
}

const show = (value: ReturnType<typeof R>) => formatDecimal(value);

export const q07Rectangles = defineTemplate<Params, ReturnType<typeof derive>>({
  templateId: "edexcel-1ma1h-2019-06-q07-rectangles",
  revision: 1,
  sourceUnitKey: pilotUnitKey(7),
  sourceQuestionNumber: 7,
  topics: ["geometry", "perimeter and area"],
  structure: [{ partId: "", marks: 4 }],
  sourceParameters: { qr: 10, pqHalves: 9, perimeter: 26 },
  review: PILOT_REVIEW,
  sample: (rng) => ({ qr: rng.pick([6, 8, 10, 12, 14]), pqHalves: rng.int(3, 9) * 2 - 1, perimeter: rng.int(10, 20) * 2 }),
  constraints: (parameters) => {
    const { pq, ab, area } = derive(parameters);
    const violations: string[] = [];
    if (parameters.pqHalves % 2 === 0) violations.push("pq-must-be-half-integer");
    if (!area.isInteger()) violations.push("area-integer");
    if (pq.toNumber() * 1.5 > parameters.qr) violations.push("pqrs-must-be-tall");
    if (ab.toNumber() < pq.toNumber() + 1.5) violations.push("abcd-must-be-wide");
    if (ab.toNumber() > 16) violations.push("ab-range");
    if (area.toNumber() === parameters.perimeter) violations.push("area-differs-from-perimeter");
    return violations;
  },
  derive,
  buildQuestion: ({ qr, perimeter }, derived, context) => questionDocument(context.questionNumber, [
    p("Here are two rectangles."),
    figure(derived.diagram),
    p(math("QR"), ` = ${qr} cm`),
    p(math("BC = PQ")),
    p("The perimeter of ", italic("ABCD"), ` is ${perimeter} cm`),
    p("The area of ", italic("PQRS"), ` is ${show(derived.area)} `, math(sup(upright("cm"), 2))),
  ], [questionPart("", { prompt: [p("Find the length of ", italic("AB"), ".")], marks: 4, working: 260, answer: answerLine(undefined, ["cm"]) })]),
  solve: ({ qr, perimeter }, derived) => {
    const pq = show(derived.pq);
    const area = show(derived.area);
    return { parts: [schemePart({
      partId: "",
      marks: 4,
      answer: [show(derived.ab)],
      accepted: [["Accept ", math(fracR(derived.ab))]],
      criteria: [
        criterion("p1", "P1", ["for process to use the area of ", italic("PQRS"), " to find the length of ", italic("PQ"), `, eg ${qr}y = ${area} or ${area} ÷ ${qr} (= ${pq})`]),
        criterion("p2", "P1", ["for process to use the perimeter of ", italic("ABCD"), `, eg 2x + 2 × “${pq}” = ${perimeter} or ${perimeter} − 2 × “${pq}” (= ${show(R(perimeter).sub(derived.pq.mul(R(2))))}) or ${perimeter} ÷ 2 (= ${show(derived.halfPerimeter)})`]),
        criterion("p3", "P1", ["for process to use length of ", italic("BC"), " to find length of ", italic("AB"), `, eg solves 2x + 2 × “${pq}” = ${perimeter} or (${perimeter} − 2 × “${pq}”) ÷ 2 or “${show(derived.halfPerimeter)}” − “${pq}”`], { dependsOn: ["p2"] }),
        criterion("a1", "A1", [`for ${show(derived.ab)} or `, math(mixedR(derived.ab))], { dependsOn: ["p3"] }),
      ],
      working: [
        display(`${area} ÷ ${qr} = ${pq}`),
        p(math("BC = PQ"), ` = ${pq} cm`),
        display(`${perimeter} ÷ 2 = ${show(derived.halfPerimeter)}`),
        display(`${show(derived.halfPerimeter)} − ${pq} = ${show(derived.ab)}`),
      ],
    })] };
  },
  verify: ({ qr, perimeter }, derived) => [
    ...validateDiagram(derived.diagram),
    check("perimeter-reconstructs", derived.ab.add(derived.pq).mul(R(2)).eq(R(perimeter))),
    check("area-reconstructs", derived.pq.mul(R(qr)).eq(derived.area)),
    check("ab-is-half-integer", derived.ab.mul(R(2)).isInteger() && !derived.ab.isInteger()),
  ],
});
