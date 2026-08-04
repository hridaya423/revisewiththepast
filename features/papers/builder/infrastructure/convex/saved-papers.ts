import "server-only";

import { api } from "@/convex/_generated/api";
import { fetchAuthMutation, fetchAuthQuery } from "@/shared/infrastructure/auth/convex";

export function getSavedPaperByImportKey(importKey: string) {
  return fetchAuthQuery(api.savedPapers.getSavedPaperByImportKey, { importKey });
}

export async function createSavedPaper(input: {
  importKey?: string;
  subjectKey: string;
  boardCode: string;
  subjectSlug: string;
  tier?: "none" | "foundation" | "higher";
  title: string;
  targetMarks: number;
  totalMarks: number;
  timeMinutes: number;
  pdfFileName: string;
  pdfContentType: string;
  pdfFileSize: number;
  pdfCdnUploadId: string;
  pdfUrl: string;
  questions: Array<{
    displayOrder: number;
    unitKey: string;
    sourceQuestionKey: string;
    sourceRelativePath: string;
    paperCode: string;
    year?: number;
    session?: string;
    questionNumber: string;
    questionPartNumber?: string | null;
    totalMarks: number;
    promptText: string;
    contextText?: string | null;
    canonicalLeafIds?: string[];
    topicLabels?: string[];
  }>;
}) {
  return fetchAuthMutation(api.savedPapers.createSavedPaper, input);
}
