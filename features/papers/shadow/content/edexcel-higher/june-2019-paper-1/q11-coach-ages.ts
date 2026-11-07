import { cell, p, table } from "../../../domain/content";
import type { ShadowRng } from "../../../domain/parameters";
import { check } from "../../../domain/types";
import { PILOT_REVIEW, criterion, defineTemplate, pilotUnitKey, questionDocument, questionPart, schemePart } from "./common";

type Params = { ages: number[]; median: number; lower: number; upper: number; least: number; greatest: number; person: string };

const COUNT = 23;

function summary(ages: number[]) {
  const sorted = [...ages].sort((a, b) => a - b);
  return { least: sorted[0]!, lower: sorted[5]!, median: sorted[11]!, upper: sorted[17]!, greatest: sorted[COUNT - 1]! };
}

function derive(parameters: Params) {
  const a = summary(parameters.ages);
  const b = { least: parameters.least, lower: parameters.lower, median: parameters.median, upper: parameters.upper, greatest: parameters.greatest };
  const rangeA = a.greatest - a.least;
  const rangeB = b.greatest - b.least;
  const iqrA = a.upper - a.lower;
  const iqrB = b.upper - b.lower;
  return { a, b, rangeA, rangeB, iqrA, iqrB, aYounger: a.median < b.median, aVariesMore: rangeA > rangeB };
}

function sampleAges(rng: ShadowRng) {
  const centre = rng.int(42, 62);
  const spread = rng.int(14, 24);
  return Array.from({ length: COUNT }, () => Math.max(18, Math.min(88, centre + Math.round((rng.next() + rng.next() + rng.next() - 1.5) * spread)))).sort((x, y) => x - y);
}

export const q11CoachAges = defineTemplate<Params, ReturnType<typeof derive>>({
  templateId: "edexcel-1ma1h-2019-06-q11-coach-ages",
  revision: 1,
  sourceUnitKey: pilotUnitKey(11),
  sourceQuestionNumber: 11,
  topics: ["statistics", "averages and spread", "comparing distributions"],
  structure: [{ partId: "a", marks: 2 }, { partId: "b", marks: 1 }, { partId: "c", marks: 1 }],
  sourceParameters: {
    ages: [41, 42, 44, 48, 52, 53, 53, 53, 56, 57, 57, 59, 60, 61, 63, 64, 64, 66, 67, 69, 74, 77, 79],
    median: 70, lower: 54, upper: 73, least: 42, greatest: 85, person: "Richard",
  },
  review: PILOT_REVIEW,
  sample: (rng) => {
    const ages = sampleAges(rng);
    const a = summary(ages);
    const younger = rng.chance(0.5);
    const variesMore = rng.chance(0.5);
    const median = a.median + (younger ? 1 : -1) * rng.int(5, 12);
    const iqr = Math.max(4, a.upper - a.lower + (variesMore ? -1 : 1) * rng.int(4, 8));
    const lower = median - Math.round(iqr * (0.35 + 0.3 * rng.next()));
    const range = Math.max(iqr + 6, a.greatest - a.least + (variesMore ? -1 : 1) * rng.int(4, 9));
    const least = lower - Math.round((range - iqr) * (0.3 + 0.4 * rng.next()));
    return { ages, median, lower, upper: lower + iqr, least, greatest: least + range, person: rng.pick(["Richard", "Hannah", "Omar", "Grace", "Luca", "Zainab"]) };
  },
  constraints: (parameters) => {
    const { a, b, rangeA, rangeB, iqrA, iqrB } = derive(parameters);
    const violations: string[] = [];
    if (parameters.ages.length !== COUNT) violations.push("twenty-three-ages");
    if (parameters.ages.some((age, index) => index > 0 && age < parameters.ages[index - 1]!)) violations.push("ages-sorted");
    if (!(b.least < b.lower && b.lower < b.median && b.median < b.upper && b.upper < b.greatest)) violations.push("coach-b-summary-ordered");
    if (b.least < 16 || b.greatest > 95) violations.push("coach-b-plausible-ages");
    if (!(a.lower < a.median && a.median < a.upper)) violations.push("coach-a-quartiles-distinct");
    if (iqrA < 8) violations.push("coach-a-spread");
    if (Math.abs(a.median - b.median) < 5) violations.push("medians-clearly-differ");
    if (Math.abs(rangeA - rangeB) < 3 || Math.abs(iqrA - iqrB) < 3) violations.push("spreads-clearly-differ");
    if (Math.sign(rangeA - rangeB) !== Math.sign(iqrA - iqrB)) violations.push("range-and-iqr-agree");
    if (a.least === b.least || a.greatest === b.greatest) violations.push("extremes-differ");
    return violations;
  },
  derive,
  buildQuestion: (parameters, derived, context) => {
    const rows = [parameters.ages.slice(0, 12), parameters.ages.slice(12)];
    const ageTable = table(rows.map((row) => [...row.map((age) => cell(String(age))), ...Array.from({ length: 12 - row.length }, () => [])]), { borders: false, colWidth: 33 });
    const summaryTable = (values: Array<number | null>) => table([
      ["Median", values[0]], ["Lower quartile", values[1]], ["Upper quartile", values[2]], ["Least age", values[3]], ["Greatest age", values[4]],
    ].map(([label, value]) => [cell(String(label)), value === null ? [] : cell(String(value))]), { firstColWidth: 104, colWidth: 66 });
    return questionDocument(context.questionNumber, [
      p("A bus company recorded the ages, in years, of the people on coach A and the people on coach B."),
      p(`Here are the ages of the ${COUNT} people on coach A.`),
      ageTable,
    ], [
      questionPart("a", {
        prompt: [p("Complete the table below to show information about the ages of the people on coach A."), summaryTable([null, null, null, derived.a.least, derived.a.greatest])],
        marks: 2,
        working: 40,
        answer: { kind: "none" },
      }),
      questionPart("b", {
        lead: [
          p("Here is some information about the ages of the people on coach B."),
          summaryTable([derived.b.median, derived.b.lower, derived.b.upper, derived.b.least, derived.b.greatest]),
          p(`${parameters.person} says that the people on coach A are younger than the people on coach B.`),
        ],
        prompt: [p(`Is ${parameters.person} correct?`), p("You must give a reason for your answer.")],
        marks: 1,
        working: 0,
        answer: { kind: "reason", lines: 3 },
      }),
      questionPart("c", {
        lead: [p(`${parameters.person} says that the people on coach A vary more in age than the people on coach B.`)],
        prompt: [p(`Is ${parameters.person} correct?`), p("You must give a reason for your answer.")],
        marks: 1,
        working: 0,
        answer: { kind: "reason", lines: 3 },
      }),
    ]);
  },
  solve: ({ person }, derived) => {
    const { a, b, rangeA, rangeB, iqrA, iqrB } = derived;
    const medianComparison = derived.aYounger ? `“${a.median}” < ${b.median}` : `“${a.median}” > ${b.median}`;
    const rangeComparison = rangeA < rangeB ? `${rangeA} < ${rangeB}` : `${rangeA} > ${rangeB}`;
    const iqrComparison = iqrA < iqrB ? `“${iqrA}” < ${iqrB}` : `“${iqrA}” > ${iqrB}`;
    return { parts: [
      schemePart({
        partId: "a",
        marks: 2,
        answer: [`${a.median}, ${a.lower}, ${a.upper}`],
        criteria: [criterion("b2", "B2", [`for Median = ${a.median}, LQ = ${a.lower}, UQ = ${a.upper}; may be seen in working`])],
        partialCredit: [{ code: "B1", text: ["for one correct"] }],
        working: [
          p(`There are ${COUNT} ages, so the median is the 12th value, the lower quartile the 6th value and the upper quartile the 18th value.`),
          p(`Median = ${a.median}, lower quartile = ${a.lower}, upper quartile = ${a.upper}`),
        ],
      }),
      schemePart({
        partId: "b",
        marks: 1,
        answer: [derived.aYounger ? "Yes, with reason" : "No, with reason"],
        criteria: [criterion("c1", "C1", [`for ${derived.aYounger ? "Yes" : "No"} and a comment comparing median ages, ft from (a)`], { followThrough: true })],
        accepted: [
          [`Acceptable: ${medianComparison}; the median is ${derived.aYounger ? "lower" : "higher"} for coach A; the middle age is ${derived.aYounger ? "lower" : "higher"} on coach A`],
          [`Not acceptable: a comparison without a conclusion, eg “The median for coach A is ${a.median} and coach B is ${b.median}”; comparisons of the oldest or youngest people only`],
        ],
        working: [p(`Coach A median ${a.median}, coach B median ${b.median}. The median age is ${derived.aYounger ? "lower" : "higher"} for coach A, so ${person} is ${derived.aYounger ? "correct" : "not correct"}.`)],
        dependsOnParts: ["a"],
        manualMarking: true,
      }),
      schemePart({
        partId: "c",
        marks: 1,
        answer: [derived.aVariesMore ? "Yes, with reason" : "No, with reason"],
        criteria: [criterion("c1", "C1", [`for ${derived.aVariesMore ? "Yes" : "No"} and a comment comparing spreads of ages from ranges or IQRs, ft from (a)`], { followThrough: true })],
        accepted: [
          [`Working: A: range = ${rangeA}, IQR = “${iqrA}”; B: range = ${rangeB}, IQR = ${iqrB}`],
          [`Acceptable: ${rangeComparison} or ${iqrComparison}; the range is ${rangeA > rangeB ? "larger" : "smaller"} for coach A; the IQR is ${iqrA > iqrB ? "larger" : "smaller"} for coach A`],
          ["Not acceptable: comparing quartiles or extremes without a measure of spread, eg “Coach A ranges from ", `${a.least}–${a.greatest} but coach B ranges from ${b.least}–${b.greatest}”`],
        ],
        working: [p(`Coach A: range ${a.greatest} − ${a.least} = ${rangeA}, IQR ${a.upper} − ${a.lower} = ${iqrA}. Coach B: range ${b.greatest} − ${b.least} = ${rangeB}, IQR ${b.upper} − ${b.lower} = ${iqrB}. Coach A ${derived.aVariesMore ? "has the larger spread" : "has the smaller spread"}, so ${person} is ${derived.aVariesMore ? "correct" : "not correct"}.`)],
        dependsOnParts: ["a"],
        manualMarking: true,
      }),
    ] };
  },
  verify: (parameters, derived) => {
    const countAtMost = (value: number) => parameters.ages.filter((age) => age <= value).length;
    const countAtLeast = (value: number) => parameters.ages.filter((age) => age >= value).length;
    return [
      check("median-splits-data", countAtMost(derived.a.median) >= 12 && countAtLeast(derived.a.median) >= 12),
      check("lower-quartile-position", countAtMost(derived.a.lower) >= 6 && countAtLeast(derived.a.lower) >= 18),
      check("upper-quartile-position", countAtMost(derived.a.upper) >= 18 && countAtLeast(derived.a.upper) >= 6),
      check("extremes-match-table", derived.a.least === Math.min(...parameters.ages) && derived.a.greatest === Math.max(...parameters.ages)),
    ];
  },
});
