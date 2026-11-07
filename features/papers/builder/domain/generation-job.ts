export type GenerationJobStatus = "queued" | "generating" | "mark-schemes" | "assembling" | "succeeded" | "failed" | "cancelled";

export type GenerationJobPaperMeta = {
  index: number;
  fileName: string;
  questionCount: number;
  totalMarks: number;
  timeMinutes: number;
  coveredTopics: number;
  selectedUnitKeys: string[];
  selectedUnitMarks: number[];
  selectedSourceQuestionKeys?: string[];
  coveredLeafTopicIds?: string[];
  generationReceiptId: string | null;
  markSchemeGenerated: boolean;
  markSchemeWarning: string | null;
  savedPaperId?: string;
  previewReady?: boolean;
};

export type GenerationJobSnapshot = {
  jobId: string;
  subjectKey: string;
  subjectTier?: "foundation" | "higher";
  status: GenerationJobStatus;
  message: string;
  progress: number;
  totalPapers: number;
  completedPapers: number;
  includeMarkScheme: boolean;
  papers: GenerationJobPaperMeta[];
  resultFileName: string | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  runVersion?: number;
  lastRetryRequestKey?: string;
};

export type GenerationArtifact = {
  part: string;
  storageId: string;
  fileName: string;
};

export function isGenerationTerminal(status: GenerationJobStatus) {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

export function mayUpdateGeneration(input: { status: GenerationJobStatus; workerId?: string; leaseExpiresAt?: number }, workerId: string, now: number) {
  return !isGenerationTerminal(input.status) && input.workerId === workerId && (input.leaseExpiresAt ?? 0) > now;
}

export function hasGenerationAccess(job: { ownerId?: string; guestHash: string }, viewer: { ownerId?: string; guestHash: string }) {
  return job.ownerId ? job.ownerId === viewer.ownerId : Boolean(viewer.guestHash && job.guestHash === viewer.guestHash);
}
