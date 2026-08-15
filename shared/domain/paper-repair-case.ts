import { z } from "zod";

export const defectCodes = [
  "identity-collapse",
  "duplicate-ownership",
  "missing-figure",
  "clipped-context",
  "lost-response-surface",
  "neighbor-leakage",
  "source-furniture",
  "source-total-leakage",
  "mark-scheme-contamination",
  "multipart-contamination",
  "column-drift",
  "incomplete-asset-binding",
] as const;

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const sourcePdfSchema = z.object({
  path: z.string().trim().min(1),
  sha256,
  selectedUnitKeys: z.array(z.string().trim().min(1)).min(1),
});
const artifactEvidenceSchema = z.object({
  path: z.string().trim().min(1),
  kind: z.enum(["screenshot", "pdf", "report", "log"]),
  available: z.literal(true),
  note: z.string().trim().min(1),
  page: z.number().int().positive().optional(),
});
const ownershipSchema = z.object({
  page: z.number().int().positive(),
  role: z.string().trim().min(1),
  unitKey: z.string().trim().min(1),
});

const paperRepairCaseSchema = z.object({
  id: z.string().trim().min(1),
  defectCode: z.enum(defectCodes),
  status: z.literal("UNPROVEN"),
  reportPath: z.string().trim().min(1),
  subject: z.string().trim().min(1),
  tier: z.enum(["foundation", "higher"]).nullable(),
  paperIndex: z.number().int().nonnegative(),
  seed: z.number().int(),
  resolvedRequestedMarks: z.number().int().nonnegative(),
  selectedUnitKeys: z.array(z.string().trim().min(1)).min(1),
  selectedSourceQuestionKeys: z.array(z.string().trim().min(1)).min(1),
  selectedUnitMarks: z.array(z.number().int().nonnegative()).min(1),
  totalMarks: z.number().int().nonnegative(),
  sourcePdfs: z.array(sourcePdfSchema).min(1),
  auditedPageOwnership: z.array(ownershipSchema).min(1),
  artifactEvidence: z.array(artifactEvidenceSchema).min(1),
  sentinel: z.boolean(),
  sentinelInvariant: z.string().trim().min(1).optional(),
});

export type PaperRepairCase = z.infer<typeof paperRepairCaseSchema>;

function unique(values: string[]) {
  return new Set(values).size === values.length;
}

function validateCase(value: PaperRepairCase) {
  if (!unique(value.selectedUnitKeys)) throw new Error(`Duplicate selected unit key in ${value.id}`);
  if (value.selectedUnitKeys.length !== value.selectedSourceQuestionKeys.length || value.selectedUnitKeys.length !== value.selectedUnitMarks.length) {
    throw new Error(`Report arrays do not have the same length in ${value.id}`);
  }
  if (value.selectedUnitMarks.reduce((sum, marks) => sum + marks, 0) !== value.totalMarks) {
    throw new Error(`Unit marks do not sum to total in ${value.id}`);
  }
  const sourceUnits = value.sourcePdfs.flatMap((source) => source.selectedUnitKeys);
  if (sourceUnits.some((unitKey) => !value.selectedUnitKeys.includes(unitKey))) {
    throw new Error(`Source hash references an unselected unit in ${value.id}`);
  }
  if (value.selectedUnitKeys.some((unitKey) => !sourceUnits.includes(unitKey))) {
    throw new Error(`Selected unit has no source hash in ${value.id}`);
  }
  if (value.auditedPageOwnership.some((owner) => !value.selectedUnitKeys.includes(owner.unitKey))) {
    throw new Error(`Audited ownership references an unselected unit in ${value.id}`);
  }
  if (value.sentinel && !value.sentinelInvariant) throw new Error(`Sentinel invariant is required in ${value.id}`);
  return value;
}

export function parsePaperRepairCases(input: unknown): readonly PaperRepairCase[] {
  const parsed = z.array(paperRepairCaseSchema).parse(input).map(validateCase);
  if (!unique(parsed.map((repairCase) => repairCase.id))) throw new Error("Duplicate case ID");
  for (const defectCode of defectCodes) {
    const cases = parsed.filter((repairCase) => repairCase.defectCode === defectCode);
    if (!cases.some((repairCase) => !repairCase.sentinel) || !cases.some((repairCase) => repairCase.sentinel)) {
      throw new Error(`Defect class ${defectCode} requires an affected case and sentinel`);
    }
  }
  return Object.freeze(parsed);
}

export function verifySourceHashes(repairCase: PaperRepairCase, actualHashes: ReadonlyMap<string, string>) {
  for (const source of repairCase.sourcePdfs) {
    const actualHash = actualHashes.get(source.path);
    if (!actualHash) throw new Error(`Missing source hash for ${source.path}`);
    if (actualHash !== source.sha256) throw new Error(`Changed source: ${source.path}`);
  }
}

export function verifyReportSnapshot(repairCase: PaperRepairCase, report: unknown) {
  const parsed = z.object({
    subjectKey: z.string(),
    subjectTier: z.enum(["foundation", "higher"]).nullable(),
    paperIndex: z.number().int(),
    seed: z.number().int(),
    resolvedTargetMarks: z.number().int(),
    selectedUnitKeys: z.array(z.string()),
    selectedSourceQuestionKeys: z.array(z.string()),
    selectedUnitMarks: z.array(z.number().int()),
    totalMarks: z.number().int(),
  }).parse(report);
  if (parsed.subjectKey !== repairCase.subject || parsed.subjectTier !== repairCase.tier || parsed.paperIndex !== repairCase.paperIndex || parsed.seed !== repairCase.seed || parsed.resolvedTargetMarks !== repairCase.resolvedRequestedMarks || parsed.totalMarks !== repairCase.totalMarks || JSON.stringify(parsed.selectedUnitKeys) !== JSON.stringify(repairCase.selectedUnitKeys) || JSON.stringify(parsed.selectedSourceQuestionKeys) !== JSON.stringify(repairCase.selectedSourceQuestionKeys) || JSON.stringify(parsed.selectedUnitMarks) !== JSON.stringify(repairCase.selectedUnitMarks)) {
    throw new Error(`Report snapshot mismatch in ${repairCase.id}`);
  }
}
