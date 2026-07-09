import "server-only";

import type { SubjectTierKey } from "@/lib/paper-maker/combined-science";
import type { QuestionUnit } from "@/lib/paper-maker/aqa-geography";
import { getPaperMakerQuestionBankFromConvex } from "@/lib/paper-maker/convex";
import { getPaperMakerSubject, type PaperMakerSubjectKey } from "@/lib/paper-maker/subjects";
import { filterQuestionBankForSubjectTier, groupQuestionUnitsForSubject } from "@/lib/paper-maker/units";
import { compareExamQuestionOrder } from "@/lib/marking/question-path";
import type { DetectedPaperIdentity } from "@/lib/marking/paper-identity";

function inferTierFromSourceRelativePath(sourceRelativePath: string) {
  const normalized = sourceRelativePath.toLowerCase();
  if (normalized.includes("/foundation/")) return "foundation" as const;
  if (normalized.includes("/higher/")) return "higher" as const;
  return "none" as const;
}

export async function getMarkableUnitsForSubject(subjectKey: PaperMakerSubjectKey, subjectTier?: SubjectTierKey | null): Promise<QuestionUnit[]> {
  const subject = getPaperMakerSubject(subjectKey);
  if (!subject) {
    throw new Error(`Unknown subject ${subjectKey}.`);
  }

  const questionBank = await getPaperMakerQuestionBankFromConvex(subject.boardCode, subject.subjectSlug);
  return groupQuestionUnitsForSubject(subjectKey, filterQuestionBankForSubjectTier(subjectKey, questionBank, subjectTier));
}

export async function getMarkableUnitsByUnitKeys(subjectKey: PaperMakerSubjectKey, unitKeys: string[], subjectTier?: SubjectTierKey | null) {
  const units = await getMarkableUnitsForSubject(subjectKey, subjectTier);
  const unitsByKey = new Map(units.map((unit) => [unit.unitKey, unit] as const));
  return unitKeys
    .map((unitKey) => unitsByKey.get(unitKey))
    .filter((unit): unit is NonNullable<typeof unit> => unit !== undefined);
}

export async function getMarkableUnitsForPaperIdentity(identity: DetectedPaperIdentity) {
  const units = await getMarkableUnitsForSubject(
    "edexcel-mathematics-higher",
    identity.tier === "foundation" || identity.tier === "higher" ? identity.tier : null,
  );
  return units.filter((unit) => {
    if (unit.paperCode !== identity.paperCode) return false;
    if (unit.year !== identity.year) return false;
    if ((unit.session ?? "").toLowerCase() !== identity.session.toLowerCase()) return false;
    if (identity.sourceRelativePath && unit.sourceRelativePath !== identity.sourceRelativePath) return false;
    return inferTierFromSourceRelativePath(unit.sourceRelativePath) === identity.tier;
  });
}

export function sortUnitsInExamOrder(units: QuestionUnit[], getQuestionPath: (unit: QuestionUnit) => string[]) {
  return [...units].sort((left, right) => compareExamQuestionOrder(
    { questionNumber: left.questionNumber, questionPath: getQuestionPath(left) },
    { questionNumber: right.questionNumber, questionPath: getQuestionPath(right) },
  ));
}

export async function getMarkableUnitsBySourcePage(sourceRelativePath: string, pageNumber: number) {
  const units = await getMarkableUnitsForSubject("edexcel-mathematics-higher");
  return units.filter((unit) => (
    unit.sourceRelativePath === sourceRelativePath
    && unit.parts.some((part) => part.pageNumbers.includes(pageNumber) || part.pageNumber === pageNumber)
  ));
}
