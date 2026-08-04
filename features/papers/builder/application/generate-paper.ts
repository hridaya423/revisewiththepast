import { generateCustomPaper, PaperGenerationError } from "../infrastructure/generation/generate";
import { getPaperMakerSubject } from "../domain/subjects";
import type { GeneratePaperRequest } from "../contracts/generate-paper";
import { DomainError, ValidationError } from "@/shared/application/errors";
import type { SubjectTierKey } from "@/shared/domain/subject";

export async function generatePaper(input: GeneratePaperRequest) {
  const subject = getPaperMakerSubject(input.subjectKey);
  if (!subject) throw new ValidationError("Unknown subject selection.");
  if (!subject.generationEnabled) {
    throw new DomainError(`${subject.label} is not enabled for generation yet.`, 501);
  }

  try {
    return await generateCustomPaper({
      subjectKey: input.subjectKey,
      subjectTier: input.subjectTier as SubjectTierKey | undefined,
      selectedTopicNodeIds: input.selectedTopicNodeIds,
      targetMarks: input.targetMarks,
      questionMix: input.questionMix,
      requestedTimeMinutes: input.timeMinutes,
      targetMode: input.targetMode,
      paperCodes: input.paperCodes,
      maxQuestions: input.maxQuestions,
      excludeSourceQuestionKeys: input.excludeSourceQuestionKeys,
      remainingPaperCount: input.remainingPaperCount,
      priorSelectedUnitMarks: input.priorSelectedUnitMarks,
      priorPaperCount: input.priorPaperCount,
      priorCoveredLeafTopicIds: input.priorCoveredLeafTopicIds,
      selectAllTopics: input.selectAllTopics,
      seed: input.seed,
    });
  } catch (error) {
    if (error instanceof PaperGenerationError) {
      throw new DomainError(error.message, error.status >= 500 ? error.status : 422);
    }
    throw error;
  }
}

export function buildGenerationHeaders(result: Awaited<ReturnType<typeof generatePaper>>, questionMix: GeneratePaperRequest["questionMix"]) {
  const exclusionKeys = result.selection.selectedUnits.map((unit) => (
    result.subject.key === "aqa-business" || result.subject.key === "edexcel-business" || result.subject.key === "aqa-english-language"
      ? unit.sourceQuestionKey
      : unit.unitKey
  ));
  const headers: Record<string, string> = {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${result.fileName}"`,
    "X-Question-Count": String(result.selection.selectedUnits.length),
    "X-Total-Marks": String(result.selection.totalMarks),
    "X-Resolved-Target-Marks": String(result.resolvedTargetMarks),
    "X-Covered-Topics": String(result.selection.coveredLeafTopicIds.length),
    "X-Covered-Leaf-Topic-Ids": encodeURIComponent(result.selection.coveredLeafTopicIds.join("\n")),
    "X-Time-Minutes": String(result.timeMinutes),
    "X-Target-Mode": result.targetMode,
    "X-Question-Mix": questionMix,
    "X-Selected-Source-Question-Keys": encodeURIComponent(exclusionKeys.join("\n")),
    "X-Selected-Unit-Keys": encodeURIComponent(result.selection.selectedUnits.map((unit) => unit.unitKey).join("\n")),
    "X-Selected-Unit-Marks": encodeURIComponent(result.selection.selectedUnits.map((unit) => String(unit.totalMarks)).join("\n")),
  };
  if (result.selectedTierHeader) headers["X-Selected-Tier"] = result.selectedTierHeader;
  return headers;
}
