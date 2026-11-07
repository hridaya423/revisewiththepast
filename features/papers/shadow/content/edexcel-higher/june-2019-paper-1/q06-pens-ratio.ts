import { answerLine, display, figure, frac, math, p, pIndent } from "../../../domain/content";
import { DiagramBuilder, validateDiagram } from "../../../domain/diagram";
import { R } from "../../../domain/rational";
import { check } from "../../../domain/types";
import { PILOT_REVIEW, criterion, defineTemplate, gcd, pilotUnitKey, questionDocument, questionPart, schemePart } from "./common";

type Params = { pens: number[]; ratio: number[]; lots: number; day: string };

const colours = ["black", "red", "green"] as const;

function derive({ pens, ratio, lots }: Params) {
  const pensRatio = pens.map((value, index) => value * ratio[index]!);
  const share = pensRatio.reduce((sum, value) => sum + value, 0);
  const total = share * lots;
  const counts = pensRatio.map((value) => value * lots);
  const builder = new DiagramBuilder(400, 34);
  const columns = [60, 175, 290];
  colours.forEach((colour, index) => {
    builder.label(columns[index]!, 13, "number of packs", { size: 10.5, anchor: "middle" });
    builder.label(columns[index]!, 27, `of ${colour} pens sold`, { size: 10.5, anchor: "middle" });
    if (index < 2) builder.label((columns[index]! + columns[index + 1]!) / 2, 21, [math(":")], { size: 11, anchor: "middle" });
  });
  builder.label(352, 21, [math(`= ${ratio.join(" : ")}`)], { size: 11, anchor: "start" });
  return { pensRatio, share, total, counts, green: counts[2]!, diagram: builder.build("not-to-scale", `Ratio of packs sold: black to red to green is ${ratio.join(" : ")}.`) };
}

export const q06PensRatio = defineTemplate<Params, ReturnType<typeof derive>>({
  templateId: "edexcel-1ma1h-2019-06-q06-pens-ratio",
  revision: 1,
  sourceUnitKey: pilotUnitKey(6),
  sourceQuestionNumber: 6,
  topics: ["ratio and proportion", "problem solving"],
  structure: [{ partId: "", marks: 4 }],
  sourceParameters: { pens: [2, 5, 6], ratio: [7, 3, 4], lots: 4, day: "Monday" },
  review: PILOT_REVIEW,
  sample: (rng) => {
    const pens = rng.shuffle([2, 3, 4, 5, 6, 8, 10]).slice(0, 3).sort((a, b) => a - b);
    return { pens, ratio: [rng.int(2, 9), rng.int(2, 9), rng.int(2, 9)], lots: rng.int(2, 6), day: rng.pick(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]) };
  },
  constraints: (parameters) => {
    const { total, counts, share } = derive(parameters);
    const violations: string[] = [];
    const [r1, r2, r3] = parameters.ratio as [number, number, number];
    if (new Set(parameters.ratio).size !== 3) violations.push("ratio-parts-distinct");
    if (gcd(gcd(r1, r2), r3) !== 1) violations.push("ratio-simplest-form");
    if (new Set(counts).size !== 3) violations.push("colour-totals-distinct");
    if (total < 100 || total > 400) violations.push("total-range");
    const trap = R(total * r3, r1 + r2 + r3);
    if (trap.isInteger() && trap.toNumber() === counts[2]) violations.push("pack-ratio-trap-coincides");
    if (share === total) violations.push("needs-scaling");
    return violations;
  },
  derive,
  buildQuestion: ({ pens, day }, derived, context) => questionDocument(context.questionNumber, [
    p("A shop sells packs of black pens, packs of red pens and packs of green pens."),
    p("There are"),
    ...colours.map((colour, index) => pIndent(4, `${pens[index]} pens in each pack of ${colour} pens`)),
    p(`On ${day},`),
    figure(derived.diagram),
    p(`A total of ${derived.total} pens were sold.`),
  ], [questionPart("", { prompt: [p("Work out the number of green pens sold.")], marks: 4, working: 280, answer: answerLine() })]),
  solve: ({ pens, ratio }, derived) => {
    const products = pens.map((value, index) => `${value} × ${ratio[index]}`).join(" : ");
    const ratioText = derived.pensRatio.join(" : ");
    const sumText = derived.pensRatio.join(" + ");
    return { parts: [schemePart({
      partId: "",
      marks: 4,
      answer: [String(derived.green)],
      criteria: [
        criterion("p1", "P1", [`for process to find the ratio of the number of pens of each colour sold, eg ${products} (= ${ratioText})`]),
        criterion("p2", "P1", ["for process to find the proportion of green pens sold, eg ", math(frac(derived.total, sumText)), " or ", math(frac(derived.pensRatio[2]!, sumText))], { dependsOn: ["p1"] }),
        criterion("p3", "P1", ["for a complete process to find the number of green pens sold, eg ", math(frac(derived.total, sumText), ` × ${derived.pensRatio[2]}`)], { dependsOn: ["p2"] }),
        criterion("a1", "A1", ["cao"], { dependsOn: ["p3"] }),
      ],
      accepted: [["The ratio does not have to be seen as a ratio, but all three parts are needed."], [`P3 can be implied by the values ${derived.counts.join(", ")}.`]],
      working: [
        display(`${products} = ${ratioText}`),
        display(`${derived.pensRatio.join(" + ")} = ${derived.share}`),
        display(`${derived.total} ÷ ${derived.share} = ${derived.total / derived.share}`),
        display(`${derived.pensRatio[2]} × ${derived.total / derived.share} = ${derived.green}`),
      ],
    })] };
  },
  verify: ({ pens, ratio }, derived) => {
    const packs = derived.counts.map((count, index) => count / pens[index]!);
    const scale = packs[0]! / ratio[0]!;
    return [
      ...validateDiagram(derived.diagram),
      check("colour-totals-sum", derived.counts.reduce((sum, value) => sum + value, 0) === derived.total),
      check("pack-counts-follow-ratio", packs.every((value, index) => Number.isInteger(value) && value === ratio[index]! * scale)),
    ];
  },
});
