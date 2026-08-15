import { assembleMarkSchemePdf } from "../infrastructure/mark-scheme/mark-scheme";
import { getMarkableUnitsByUnitKeys } from "@/features/papers/infrastructure/paper-maker";
import { getPaperMakerSubject } from "@/shared/domain/subject-catalog";
import type { PaperMakerSubjectKey } from "@/shared/domain/paper";
import { DomainError, NotFoundError } from "@/shared/application/errors";
import type { GenerateMarkSchemeRequest } from "../contracts/mark-scheme";

export async function generateMarkScheme(input: GenerateMarkSchemeRequest) {
  const subject = getPaperMakerSubject(input.subjectKey);
  if (!subject) throw new NotFoundError("Unknown or missing subjectKey.");
  const units = await getMarkableUnitsByUnitKeys(input.subjectKey as PaperMakerSubjectKey, input.selectedUnitKeys, input.subjectTier ?? null);
  if (units.length !== input.selectedUnitKeys.length) throw new DomainError("Could not resolve every selected unit for this paper.");
  const result = await assembleMarkSchemePdf(units);
  if (result.includedCount === 0) {
    throw new DomainError(`No mark scheme pages could be assembled. ${result.failures.map((failure) => failure.error).join("; ")}`);
  }
  if (result.failures.length > 0 || result.includedCount !== units.length || result.bytes.length === 0) {
    throw new DomainError(`Could not assemble every selected question. ${result.failures.map((failure) => failure.error).join("; ")}`);
  }
  return {
    ...result,
    fileName: `${subject.coverTitle.replace(/\s+/g, "-").toLowerCase()}-mark-scheme.pdf`,
  };
}
