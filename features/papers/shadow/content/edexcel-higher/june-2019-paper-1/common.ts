import type {
  ShadowAnswerSpace,
  ShadowBlock,
  ShadowInline,
  ShadowMarkCriterion,
  ShadowQuestionDocument,
  ShadowQuestionPart,
  ShadowSolutionPart,
} from "../../../contracts/shadow-paper";
import { text } from "../../../domain/content";
import type { ShadowParameters } from "../../../domain/parameters";
import type { ShadowTemplate, ShadowTemplateReview } from "../../../domain/types";

export const PILOT_SOURCE_DIRECTORY = "edexcel/mathematics/higher/001780-2019-paper-1-question_paper-june-202019-20qp-pdf";

export const pilotUnitKey = (questionNumber: number) => `${PILOT_SOURCE_DIRECTORY}#q${questionNumber}`;

export const PILOT_REVIEW: ShadowTemplateReview = {
  status: "approved",
  reviewer: "Claude Opus 5.5 (AI maths and visual review)",
  reviewedAt: "2026-11-01",
  notes: "Source reproduction, 100 fixed seeds, boundary cases, and rendered paper/scheme pages reviewed against the June 2019 1MA1/1H paper and official mark scheme. Human maths review recommended before public catalogue release.",
};

export function defineTemplate<P extends ShadowParameters, D>(template: ShadowTemplate<P, D>): ShadowTemplate<P, D> {
  return template;
}

type RunInput = ShadowInline | string;
const runs = (values: RunInput[]): ShadowInline[] => values.map((value) => (typeof value === "string" ? text(value) : value));

export function criterion(id: string, code: string, values: RunInput[], options: { dependsOn?: string[]; followThrough?: boolean } = {}): ShadowMarkCriterion {
  return {
    id,
    code,
    text: runs(values),
    ...(options.dependsOn ? { dependsOn: options.dependsOn } : {}),
    ...(options.followThrough ? { followThrough: true } : {}),
  };
}

export function schemePart(input: {
  partId: string;
  marks: number;
  answer: RunInput[];
  accepted?: RunInput[][];
  criteria?: ShadowMarkCriterion[];
  branches?: Array<{ label?: string; criteria: ShadowMarkCriterion[]; partialCredit?: Array<{ code: string; text: RunInput[] }> }>;
  partialCredit?: Array<{ code: string; text: RunInput[] }>;
  specialCases?: Array<{ code: string; text: RunInput[] }>;
  working: ShadowBlock[];
  dependsOnParts?: string[];
  manualMarking?: boolean;
}): ShadowSolutionPart {
  const branches = input.branches ?? [{ criteria: input.criteria ?? [], ...(input.partialCredit ? { partialCredit: input.partialCredit } : {}) }];
  return {
    partId: input.partId,
    marks: input.marks,
    answer: runs(input.answer),
    accepted: (input.accepted ?? []).map(runs),
    branches: branches.map((branch) => ({
      ...(branch.label ? { label: branch.label } : {}),
      criteria: branch.criteria,
      ...(branch.partialCredit ? { partialCredit: branch.partialCredit.map((entry) => ({ code: entry.code, text: runs(entry.text) })) } : {}),
    })),
    specialCases: (input.specialCases ?? []).map((entry) => ({ code: entry.code, text: runs(entry.text) })),
    working: input.working,
    dependsOnParts: input.dependsOnParts ?? [],
    manualMarking: input.manualMarking ?? false,
  };
}

export function questionPart(id: string, input: { lead?: ShadowBlock[]; prompt: ShadowBlock[]; marks: number; working: number; answer: ShadowAnswerSpace }): ShadowQuestionPart {
  return { id, label: id ? `(${id})` : null, lead: input.lead ?? [], prompt: input.prompt, marks: input.marks, working: input.working, answer: input.answer };
}

export function questionDocument(number: number, stem: ShadowBlock[], parts: ShadowQuestionPart[]): ShadowQuestionDocument {
  return { number, stem, parts, totalMarks: parts.reduce((sum, part) => sum + part.marks, 0) };
}

const numberWords = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
export function numberWord(value: number) {
  const word = numberWords[value];
  if (!word) throw new Error(`No word for ${value}.`);
  return word;
}

export function primeFactors(value: number): number[] {
  const factors: number[] = [];
  let remaining = value;
  for (let divisor = 2; divisor * divisor <= remaining; divisor += 1) {
    while (remaining % divisor === 0) {
      factors.push(divisor);
      remaining /= divisor;
    }
  }
  if (remaining > 1) factors.push(remaining);
  return factors;
}

export function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x;
}

export const people = [
  { name: "Deon", subject: "she", object: "her" },
  { name: "Amira", subject: "she", object: "her" },
  { name: "Tomasz", subject: "he", object: "him" },
  { name: "Priya", subject: "she", object: "her" },
  { name: "Kwame", subject: "he", object: "him" },
  { name: "Elif", subject: "she", object: "her" },
  { name: "Callum", subject: "he", object: "him" },
  { name: "Mei", subject: "she", object: "her" },
] as const;

export const capitalise = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
