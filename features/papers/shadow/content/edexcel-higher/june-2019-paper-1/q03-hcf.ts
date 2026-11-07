import { answerLine, display, M, math, p, sup } from "../../../domain/content";
import { check } from "../../../domain/types";
import { PILOT_REVIEW, criterion, defineTemplate, gcd, pilotUnitKey, primeFactors, questionDocument, questionPart, schemePart } from "./common";

type Params = { hcf: number; m: number; n: number };

function derive({ hcf, m, n }: Params) {
  return { a: hcf * m, b: hcf * n };
}

function factorList(value: number) {
  const factors: number[] = [];
  for (let divisor = 1; divisor <= value; divisor += 1) if (value % divisor === 0) factors.push(divisor);
  return factors;
}

function powerForm(value: number) {
  const counts = new Map<number, number>();
  for (const prime of primeFactors(value)) counts.set(prime, (counts.get(prime) ?? 0) + 1);
  return [...counts.entries()].flatMap(([prime, count], index) => [
    ...(index > 0 ? M(" × ") : []),
    ...(count > 1 ? [sup(prime, count)] : M(String(prime))),
  ]);
}

export const q03Hcf = defineTemplate<Params, ReturnType<typeof derive>>({
  templateId: "edexcel-1ma1h-2019-06-q03-hcf",
  revision: 1,
  sourceUnitKey: pilotUnitKey(3),
  sourceQuestionNumber: 3,
  topics: ["number", "factors and multiples"],
  structure: [{ partId: "", marks: 2 }],
  sourceParameters: { hcf: 18, m: 4, n: 5 },
  review: PILOT_REVIEW,
  sample: (rng) => ({ hcf: rng.pick([12, 14, 15, 16, 18, 20, 21, 24, 28, 30]), m: rng.int(2, 6), n: rng.int(3, 7) }),
  constraints: ({ hcf, m, n }) => {
    const violations: string[] = [];
    if (m >= n) violations.push("ordered-multipliers");
    if (gcd(m, n) !== 1) violations.push("coprime-multipliers");
    if (hcf * n > 150) violations.push("numbers-too-large");
    if (hcf * m < 30) violations.push("numbers-too-small");
    if (primeFactors(hcf).length < 3) violations.push("hcf-needs-depth");
    return violations;
  },
  derive,
  buildQuestion: (_parameters, { a, b }, context) => questionDocument(context.questionNumber, [], [
    questionPart("", { prompt: [p(`Find the highest common factor (HCF) of ${a} and ${b}`)], marks: 2, working: 200, answer: answerLine() }),
  ]),
  solve: ({ hcf }, { a, b }) => {
    const smaller = [...new Set(primeFactors(hcf))].map((prime) => hcf / prime).filter((value) => value > 1).sort((x, y) => x - y);
    return { parts: [schemePart({
      partId: "",
      marks: 2,
      answer: [String(hcf)],
      criteria: [
        criterion("m1", "M1", [`for listing factors of ${a} and ${b}, at least 4 correct for each (with no more than 1 incorrect in each list), could be in factor pairs OR for the prime factors of ${a} (${primeFactors(a).join(", ")}) or ${b} (${primeFactors(b).join(", ")})`]),
        criterion("a1", "A1", [`for ${hcf} or `, math(powerForm(hcf)), " oe"], { dependsOn: ["m1"] }),
      ],
      accepted: [["A list of prime factors such as ", math(primeFactors(hcf).join(", ")), " is not enough; it must be a product."]],
      specialCases: [{ code: "SC B1", text: [`for an answer of ${smaller.join(" or ")} if M0 scored`] }],
      working: [
        p(`Factors of ${a}: ${factorList(a).join(", ")}`),
        p(`Factors of ${b}: ${factorList(b).join(", ")}`),
        display(`${a} = ${primeFactors(a).join(" × ")}`),
        display(`${b} = ${primeFactors(b).join(" × ")}`),
        p("The highest common factor is ", math(powerForm(hcf)), ` = ${hcf}`),
      ],
    })] };
  },
  verify: ({ hcf }, { a, b }) => {
    const common = factorList(a).filter((factor) => b % factor === 0);
    return [
      check("hcf-divides-both", a % hcf === 0 && b % hcf === 0),
      check("hcf-is-greatest-common-factor", Math.max(...common) === hcf),
      check("hcf-is-not-either-number", hcf !== a && hcf !== b),
      check("prime-form-reconstructs", primeFactors(hcf).reduce((product, prime) => product * prime, 1) === hcf),
    ];
  },
});
