import "server-only";

import type { QuestionUnit } from "@/shared/domain/paper";
import { PAPER_MAKER_SUBJECTS } from "@/shared/domain/subject-catalog";
import { getMarkableUnitsForSubject } from "@/features/papers/infrastructure/paper-maker";
import type { DetectedPaperIdentity } from "../domain/paper-identity";
import { compareExamQuestionOrder } from "../domain/question-path";

function inferTierFromSourceRelativePath(sourceRelativePath: string) {
  const normalized = sourceRelativePath.toLowerCase();
  if (normalized.includes("/foundation/")) return "foundation" as const;
  if (normalized.includes("/higher/")) return "higher" as const;
  return "none" as const;
}

export async function getMarkableUnitsForPaperIdentity(identity: DetectedPaperIdentity) {
  const units = await getMarkableUnitsForSubject(
    identity.subjectKey,
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

export async function getMarkableUnitsForFinishedPaper() {
  const subjects = PAPER_MAKER_SUBJECTS.filter((subject) => subject.generationEnabled);
  const unitsBySubject = await Promise.all(subjects.map((subject) => getMarkableUnitsForSubject(subject.key)));
  return unitsBySubject.flat();
}

export function sortUnitsInExamOrder(units: QuestionUnit[], getQuestionPath: (unit: QuestionUnit) => string[]) {
  return [...units].sort((left, right) => compareExamQuestionOrder(
    { questionNumber: left.questionNumber, questionPath: getQuestionPath(left) },
    { questionNumber: right.questionNumber, questionPath: getQuestionPath(right) },
  ));
}
