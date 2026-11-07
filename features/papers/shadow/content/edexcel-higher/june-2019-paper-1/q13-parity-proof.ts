import { display, italic, M, math, p, paren, sup } from "../../../domain/content";
import { check } from "../../../domain/types";
import { PILOT_REVIEW, criterion, defineTemplate, pilotUnitKey, questionDocument, questionPart, schemePart } from "./common";

type Params = { k: number; lowerBound: number };

const K_VALUES = [-9, -7, -5, -3, 1, 3, 5, 7, 9];

const term = (k: number, symbol: string) => (k === 1 ? symbol : k === -1 ? symbol : `${Math.abs(k)}${symbol}`);
const sign = (k: number) => (k < 0 ? " − " : " + ");

function expression(k: number) {
  return M(sup("n", 2), sign(k), term(k, "n"));
}

function factorised(k: number) {
  return M("n", paren(`n${sign(k)}${Math.abs(k)}`));
}

function derive({ k }: Params) {
  const oddLinear = 4 + 2 * k;
  const oddConstant = 1 + k;
  return {
    oddForm: { square: 4, linear: oddLinear, constant: oddConstant },
    evenForm: { square: 4, linear: 2 * k },
  };
}

const signed = (value: number, symbol = "") => `${value < 0 ? " − " : " + "}${Math.abs(value)}${symbol}`;

export const q13ParityProof = defineTemplate<Params, ReturnType<typeof derive>>({
  templateId: "edexcel-1ma1h-2019-06-q13-parity-proof",
  revision: 2,
  sourceUnitKey: pilotUnitKey(13),
  sourceQuestionNumber: 13,
  topics: ["algebra", "proof"],
  structure: [{ partId: "", marks: 2 }],
  sourceParameters: { k: -1, lowerBound: 1 },
  review: PILOT_REVIEW,
  sample: (rng) => ({ k: rng.pick(K_VALUES), lowerBound: rng.int(1, 3) }),
  enumerate: () => K_VALUES.flatMap((k) => [1, 2, 3].map((lowerBound) => ({ k, lowerBound }))),
  constraints: ({ k, lowerBound }) => [
    ...(k % 2 === 0 ? ["k-must-be-odd"] : []),
    ...(Math.abs(k) > 9 ? ["k-range"] : []),
    ...(lowerBound < 1 || lowerBound > 3 ? ["bound-range"] : []),
  ],
  unchangedParts: ({ k }) => (k === -1 ? [""] : []),
  derive,
  buildQuestion: ({ k, lowerBound }, _derived, context) => questionDocument(context.questionNumber, [], [
    questionPart("", {
      prompt: [p("Given that ", italic("n"), " can be any integer such that ", math(`n > ${lowerBound}`), ", prove that ", math(expression(k)), " is never an odd number.")],
      marks: 2,
      working: 240,
      answer: { kind: "none" },
    }),
  ]),
  solve: ({ k }, derived) => {
    const { oddForm, evenForm } = derived;
    const half = { square: oddForm.square / 2, linear: oddForm.linear / 2, constant: oddForm.constant / 2 };
    const oddExpansion = `4n² + 4n + 1${signed(2 * k, "n")}${signed(k)}`;
    return { parts: [schemePart({
      partId: "",
      marks: 2,
      answer: ["Proof shown"],
      criteria: [criterion("c2", "C2", [
        "for complete argument, eg ", math(factorised(k)), ` is the product of two integers that differ by ${Math.abs(k)}, an odd number, so one of them must be even`,
        "; or gives correct reasoning for n odd and n even (n odd: odd × odd ", k < 0 ? "−" : "+", " odd = even; n even: even ", k < 0 ? "−" : "+", " even = even)",
        "; or n odd: ", math(sup(paren("2n + 1"), 2), sign(k), term(k, ""), paren("2n + 1")), ` = ${oddExpansion} = 2(${half.square}n² ${signed(half.linear, "n").trim()} ${signed(half.constant).trim()}) and n even: `,
        math(sup(paren("2n"), 2), sign(k), term(k, ""), paren("2n")), ` = 4n²${signed(evenForm.linear, "n")} = 2(2n²${signed(evenForm.linear / 2, "n")})`,
      ])],
      partialCredit: [{ code: "C1", text: ["for factorising, eg ", math(factorised(k)), " OR gives correct reasoning for n odd or n even OR gives a partial explanation using n odd and n even"] }],
      working: [
        display(expression(k), " = ", factorised(k)),
        p(`n and n${sign(k)}${Math.abs(k)} differ by ${Math.abs(k)}, which is odd, so one of them is even and the other is odd.`),
        p("The product of an even number and any integer is even, so the expression is never odd."),
      ],
      manualMarking: true,
    })] };
  },
  verify: ({ k, lowerBound }, derived) => {
    const values = Array.from({ length: 400 }, (_, index) => index - 200 + lowerBound);
    const allEven = values.every((n) => (n * n + k * n) % 2 === 0);
    const oddMatches = [0, 1, 2, 5, -3].every((n) => (2 * n + 1) ** 2 + k * (2 * n + 1) === derived.oddForm.square * n * n + derived.oddForm.linear * n + derived.oddForm.constant);
    const evenMatches = [0, 1, 2, 5, -3].every((n) => (2 * n) ** 2 + k * (2 * n) === derived.evenForm.square * n * n + derived.evenForm.linear * n);
    return [
      check("expression-always-even", allEven),
      check("odd-case-expansion", oddMatches && derived.oddForm.linear % 2 === 0 && derived.oddForm.constant % 2 === 0),
      check("even-case-expansion", evenMatches),
    ];
  },
});
