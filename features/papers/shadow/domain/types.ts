import type {
  ShadowManifest,
  ShadowQuestionDocument,
  ShadowSolution,
  ShadowValidationReport,
} from "../contracts/shadow-paper";
import type { ShadowParameters, ShadowRng } from "./parameters";

export type {
  ShadowAnswerSpace,
  ShadowBlock,
  ShadowDiagram,
  ShadowDiagramItem,
  ShadowInline,
  ShadowManifest,
  ShadowMathNode,
  ShadowQuestionDocument,
  ShadowQuestionPart,
  ShadowSolution,
  ShadowSolutionPart,
  ShadowSourceIdentity,
  ShadowValidationReport,
} from "../contracts/shadow-paper";

export type ShadowCheck = { name: string; ok: boolean; detail?: string };

export const check = (name: string, ok: boolean, detail?: string): ShadowCheck => (ok ? { name, ok } : { name, ok, ...(detail ? { detail } : {}) });

export type ShadowTemplateReview = {
  status: "draft" | "approved" | "withdrawn";
  reviewer?: string;
  reviewedAt?: string;
  notes: string;
};

/** Values first printed in a given part; they must not be visible in the stem or any earlier part. */
export type ShadowReveal = { partId: string; tokens: string[] };

export type ShadowTemplateContext = { questionNumber: number };

export interface ShadowTemplate<P extends ShadowParameters = ShadowParameters, D = unknown> {
  templateId: string;
  revision: number;
  sourceUnitKey: string;
  sourceQuestionNumber: number;
  topics: string[];
  /** Ordered part IDs and marks, matching the source paper. */
  structure: Array<{ partId: string; marks: number }>;
  sourceParameters: P;
  review: ShadowTemplateReview;
  sample(rng: ShadowRng): P;
  /** Names of violated domain and difficulty invariants; empty when the candidate is acceptable. */
  constraints(parameters: P): string[];
  /** Parts whose meaningful givens still equal the source; a generated variant must change every part. */
  unchangedParts?(parameters: P): string[];
  derive(parameters: P): D;
  buildQuestion(parameters: P, derived: D, context: ShadowTemplateContext): ShadowQuestionDocument;
  solve(parameters: P, derived: D): ShadowSolution;
  /** Independent checks: substitution, reconstruction, conservation, diagram calibration. */
  verify(parameters: P, derived: D, question: ShadowQuestionDocument, solution: ShadowSolution): ShadowCheck[];
  reveals?(parameters: P, derived: D): ShadowReveal[];
  /** Full enumeration for small domains, used to record the finite variety budget. */
  enumerate?(): P[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyShadowTemplate = ShadowTemplate<any, any>;

export function templateRevisionKey(template: Pick<ShadowTemplate, "templateId" | "revision">) {
  return `${template.templateId}@${template.revision}`;
}

export type ShadowUnitVariant = {
  displayOrder: number;
  sourceUnitKey: string;
  templateRevision: string;
  unitSeed: string;
  attempt: number;
  parameters: ShadowParameters;
  question: ShadowQuestionDocument;
  solution: ShadowSolution;
  validation: ShadowValidationReport;
};

export type ShadowPaperVariant = {
  manifest: ShadowManifest;
  paperSeed: string;
  semanticHash: string;
  displayCode: string;
  units: ShadowUnitVariant[];
  totalMarks: number;
};
