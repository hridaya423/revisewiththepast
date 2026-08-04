import "server-only";

import type { SubjectTierKey } from "@/shared/domain/subject";
import type { QuestionUnit } from "@/shared/domain/paper";
import { getPaperMakerQuestionBankFromConvex } from "./question-bank";
import { getPaperMakerSubject } from "@/shared/domain/subject-catalog";
import type { PaperMakerSubjectKey } from "@/shared/domain/paper";
import { filterQuestionBankForSubjectTier, groupQuestionUnitsForSubject } from "./units";

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
