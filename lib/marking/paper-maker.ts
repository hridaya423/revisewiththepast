import "server-only";

import { groupQuestionPartsIntoUnits, type QuestionUnit } from "@/lib/paper-maker/aqa-geography";
import { getPaperMakerQuestionBankFromConvex } from "@/lib/paper-maker/convex";
import type { PaperMakerSubjectKey } from "@/lib/paper-maker/subjects";

export async function getMarkableUnitsForSubject(subjectKey: PaperMakerSubjectKey): Promise<QuestionUnit[]> {
  if (subjectKey !== "edexcel-mathematics-higher") {
    throw new Error(`Saved paper support is not implemented for ${subjectKey} yet.`);
  }

  const questionBank = await getPaperMakerQuestionBankFromConvex("edexcel", "mathematics");
  return groupQuestionPartsIntoUnits(questionBank);
}

export async function getMarkableUnitsByUnitKeys(subjectKey: PaperMakerSubjectKey, unitKeys: string[]) {
  const units = await getMarkableUnitsForSubject(subjectKey);
  const unitsByKey = new Map(units.map((unit) => [unit.unitKey, unit] as const));
  return unitKeys
    .map((unitKey) => unitsByKey.get(unitKey))
    .filter((unit): unit is NonNullable<typeof unit> => unit !== undefined);
}
