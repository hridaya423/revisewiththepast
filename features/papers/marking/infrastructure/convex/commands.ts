import "server-only";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { fetchAuthMutation, fetchAuthQuery } from "@/shared/infrastructure/auth/convex";

function toSubmissionId(value: string): Id<"markingSubmissions"> {
  return value as Id<"markingSubmissions">;
}

function toSavedPaperId(value: string): Id<"savedPapers"> {
  return value as Id<"savedPapers">;
}

export async function createMarkingSubmissionInConvex(args: {
  idempotencyKey?: string;
  newAttempt?: boolean;
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
  importSource?: "manual_upload" | "imported_pdf" | "saved_paper";
  detectedPaperIdentity?: {
    paperCode: string;
    year: number;
    session: string;
    tier: "none" | "foundation" | "higher";
    sourceRelativePath?: string;
    examReference?: string;
  };
}) {
  return await fetchAuthMutation(api.marking.createMarkingSubmission, {
    ...args,
    savedPaperId: args.savedPaperId ? toSavedPaperId(args.savedPaperId) : undefined,
  });
}

export async function updateMarkingSubmissionMetadataInConvex(args: {
  submissionId: string;
  importSource?: "manual_upload" | "imported_pdf" | "saved_paper";
  detectedPaperIdentity?: {
    paperCode: string;
    year: number;
    session: string;
    tier: "none" | "foundation" | "higher";
    sourceRelativePath?: string;
    examReference?: string;
  };
  paperCode?: string;
  year?: number;
  session?: string;
  tier?: "none" | "foundation" | "higher";
}) {
  return await fetchAuthMutation(api.marking.updateMarkingSubmissionMetadata, {
    ...args,
    submissionId: toSubmissionId(args.submissionId),
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
    submissionId: toSubmissionId(args.submissionId),
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
  scoreStatus?: "ai_suggested" | "confirmed";
}) {
  return await fetchAuthMutation(api.marking.upsertMarkingScore, {
    ...args,
    submissionId: toSubmissionId(args.submissionId),
  });
}

export async function recordQuestionScoreInConvex(args: {
  submissionId: string;
  questionKey: string;
  score?: {
    awardedMarks: number;
    maxMarks: number;
    confidence: number;
    needsReview: boolean;
    rationale: string;
    evidenceJson: string;
    scorerProvider: string;
    scorerModel: string;
    scoreStatus?: "ai_suggested" | "confirmed";
  };
  status:
    | "unmapped"
    | "pages_assigned"
    | "ocr_pending"
    | "ocr_ready"
    | "mark_scheme_ready"
    | "ai_scored"
    | "saved"
    | "needs_manual_review"
    | "failed";
  failureReason?: string;
  expectedUpdatedAt?: number | null;
}) {
  return await fetchAuthMutation(api.marking.recordQuestionScore, {
    ...args,
    submissionId: toSubmissionId(args.submissionId),
  });
}

export async function upsertMarkingQuestionStatusInConvex(args: {
  submissionId: string;
  questionKey: string;
  status:
    | "unmapped"
    | "pages_assigned"
    | "ocr_pending"
    | "ocr_ready"
    | "mark_scheme_ready"
    | "ai_scored"
    | "saved"
    | "needs_manual_review"
    | "failed";
  failureReason?: string;
}) {
  return await fetchAuthMutation(api.marking.upsertMarkingQuestionStatus, {
    ...args,
    submissionId: toSubmissionId(args.submissionId),
  });
}

export async function addMarkingResponsePageInConvex(args: {
  submissionId: string;
  uploadKey?: string;
  questionKey: string;
  questionKeys?: string[];
  questionNumber?: string;
  questionPartNumber?: string;
  pageLabel?: string;
  fileName: string;
  contentType: string;
  fileSize: number;
  cdnUploadId?: string;
  fileId?: string;
  sourceImageUrl: string;
  scriptPageNumber?: number;
  ocrText?: string;
  uploadedAt: number;
}) {
  return await fetchAuthMutation(api.marking.addMarkingResponsePage, {
    ...args,
    fileId: args.fileId as Id<"markingFiles"> | undefined,
    submissionId: toSubmissionId(args.submissionId),
  });
}

export function getMarkingResponsePageByUploadKey(submissionId: string, uploadKey: string) {
  return fetchAuthQuery(api.marking.getMarkingResponsePageByUploadKey, {
    submissionId: toSubmissionId(submissionId),
    uploadKey,
  });
}

export function validateResponsePageTargets(submissionId: string, questionKeys: string[]) {
  return fetchAuthQuery(api.marking.validateResponsePageTargets, { submissionId: toSubmissionId(submissionId), questionKeys });
}

export function mergeResponsePageTargets(submissionId: string, pageId: string, questionKeys: string[]) {
  return fetchAuthMutation(api.marking.mergeResponsePageTargets, { submissionId: toSubmissionId(submissionId), pageId: pageId as Id<"markingResponsePages">, questionKeys });
}

export async function getMarkingSubmissionBundleFromConvex(submissionId: string) {
  return await fetchAuthQuery(api.marking.getMarkingSubmissionBundle, {
    submissionId: toSubmissionId(submissionId),
  });
}
