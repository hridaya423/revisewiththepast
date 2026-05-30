import "server-only";

import { api } from "@/convex/_generated/api";
import { fetchAuthMutation, fetchAuthQuery } from "@/lib/auth-server";

export async function createMarkingSubmissionInConvex(args: {
  savedPaperId?: string;
  boardCode: string;
  subjectSlug: string;
  subjectKey: string;
  paperCode?: string;
  tier?: "none" | "foundation" | "higher";
  year?: number;
  session?: string;
  rubricVersion?: string;
  studentLabel?: string;
}) {
  return await fetchAuthMutation(api.marking.createMarkingSubmission, {
    ...args,
    savedPaperId: args.savedPaperId as never,
  });
}

export async function setMarkingSubmissionStatusInConvex(
  submissionId: string,
  status: "uploaded" | "ocr_complete" | "scored" | "review_required",
) {
  return await fetchAuthMutation(api.marking.setMarkingSubmissionStatus, {
    submissionId: submissionId as never,
    status,
  });
}

export async function upsertMarkingResponseInConvex(args: {
  submissionId: string;
  questionKey: string;
  questionNumber?: string;
  questionPartNumber?: string;
  sourceImageUrl?: string;
  ocrText: string;
  ocrProvider: string;
  ocrModel: string;
  ocrConfidence?: number;
  ocrRawJson?: string;
}) {
  return await fetchAuthMutation(api.marking.upsertMarkingResponse, {
    ...args,
    submissionId: args.submissionId as never,
  });
}

export async function upsertMarkingScoreInConvex(args: {
  submissionId: string;
  questionKey: string;
  awardedMarks: number;
  maxMarks: number;
  confidence: number;
  needsReview: boolean;
  rationale: string;
  evidenceJson: string;
  scorerProvider: string;
  scorerModel: string;
}) {
  return await fetchAuthMutation(api.marking.upsertMarkingScore, {
    ...args,
    submissionId: args.submissionId as never,
  });
}

export async function addMarkingResponsePageInConvex(args: {
  submissionId: string;
  questionKey: string;
  questionNumber?: string;
  questionPartNumber?: string;
  pageLabel?: string;
  fileName: string;
  contentType: string;
  fileSize: number;
  cdnUploadId: string;
  sourceImageUrl: string;
  uploadedAt: number;
}) {
  return await fetchAuthMutation(api.marking.addMarkingResponsePage, {
    ...args,
    submissionId: args.submissionId as never,
  });
}

export async function getMarkingSubmissionBundleFromConvex(submissionId: string) {
  return await fetchAuthQuery(api.marking.getMarkingSubmissionBundle, {
    submissionId: submissionId as never,
  });
}
