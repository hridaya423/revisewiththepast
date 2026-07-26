import { groupAqaBusinessQuestionUnits } from "@/lib/paper-maker/aqa-business";
import { groupAqaEnglishLanguageSectionUnits } from "@/lib/paper-maker/aqa-english-language";
import {
  groupQuestionPartsIntoUnits,
  groupQuestionUnitsBySourceQuestion,
  type QuestionBankPart,
} from "@/lib/paper-maker/aqa-geography";
import {
  filterCombinedScienceQuestionBankByTier,
  filterQuestionBankByTier,
  type SubjectTierKey,
} from "@/lib/paper-maker/combined-science";
import { groupEdexcelBusinessQuestionUnits } from "@/lib/paper-maker/edexcel-business";
import type { PaperMakerSubjectKey } from "@/lib/paper-maker/subjects";

export function filterQuestionBankForSubjectTier(
  subjectKey: PaperMakerSubjectKey,
  questionBank: QuestionBankPart[],
  tier?: SubjectTierKey | null,
) {
  const effectiveTier = tier === undefined && subjectKey === "edexcel-mathematics-higher" ? "higher" : tier;
  if (!effectiveTier) return questionBank;
  if (subjectKey === "edexcel-combined-science") {
    return filterCombinedScienceQuestionBankByTier(questionBank, effectiveTier);
  }
  return filterQuestionBankByTier(questionBank, effectiveTier);
}

export function groupQuestionUnitsForSubject(subjectKey: PaperMakerSubjectKey, questionBank: QuestionBankPart[]) {
  const units = groupQuestionPartsIntoUnits(questionBank);

  if (subjectKey === "edexcel-business") return groupEdexcelBusinessQuestionUnits(units);
  if (subjectKey === "aqa-business") return groupAqaBusinessQuestionUnits(units);
  if (subjectKey === "aqa-english-language") return groupAqaEnglishLanguageSectionUnits(units);
  if ([
    "edexcel-combined-science",
    "edexcel-biology",
    "edexcel-chemistry",
    "edexcel-physics",
    "ocr-computer-science",
    "edexcel-mathematics-higher",
    "edexcel-french-reading",
  ].includes(subjectKey)) {
    return groupQuestionUnitsBySourceQuestion(units);
  }

  return units;
}
