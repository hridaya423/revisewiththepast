import { createMarkingSubmissionInConvex, getMarkingSubmissionBundleFromConvex } from "../infrastructure/convex/commands";
import { getSavedPaper } from "../infrastructure/convex/queries";
import type { CreateSubmissionRequest } from "../contracts/http";
import { NotFoundError, ValidationError } from "@/shared/application/errors";

export async function createSubmission(input: CreateSubmissionRequest) {
  const savedPaper = input.savedPaperId
    ? await getSavedPaper(input.savedPaperId).catch(() => null)
    : null;

  if (input.savedPaperId && !savedPaper?.savedPaper) {
    throw new NotFoundError("The saved paper could not be found.");
  }

  const canonicalPaper = savedPaper?.savedPaper;
  const canonicalQuestion = savedPaper?.questions[0];
  const boardCode = canonicalPaper?.boardCode ?? input.boardCode?.toLowerCase();
  const subjectSlug = canonicalPaper?.subjectSlug ?? input.subjectSlug?.toLowerCase();
  const subjectKey = canonicalPaper?.subjectKey ?? input.subjectKey;
  if (!boardCode || !subjectSlug || !subjectKey) {
    throw new ValidationError("boardCode, subjectSlug and subjectKey are required unless a savedPaperId is provided.");
  }

  const tier = canonicalPaper?.tier ?? input.tier;
  const submissionId = await createMarkingSubmissionInConvex({
    savedPaperId: input.savedPaperId,
    boardCode,
    subjectSlug,
    subjectKey,
    paperCode: canonicalQuestion?.paperCode ?? input.paperCode,
    tier,
    year: canonicalQuestion?.year ?? input.year,
    session: canonicalQuestion?.session ?? input.session?.toLowerCase(),
    rubricVersion: input.rubricVersion,
    studentLabel: input.studentLabel ?? (canonicalPaper ? `${canonicalPaper.title} script` : undefined),
    importSource: input.savedPaperId ? "saved_paper" : "manual_upload",
  });

  return { submissionId };
}

export async function getSubmission(submissionId: string) {
  return await getMarkingSubmissionBundleFromConvex(submissionId);
}
