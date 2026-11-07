"use client";

export {
  cancelPaperGenerationJob,
  downloadPaperGenerationFile,
  requestMarkScheme,
  requestPaperGeneration,
  requestSavedPaper,
  requestSubjectDetail,
  runPaperGenerationJob,
} from "./builder/presentation/api-client";
export type { GenerationJobSnapshot } from "./builder/presentation/api-client";
export {
  uploadResponsePage,
  setResponsePageMapping,
  importFinishedPaper,
  createMarkingSubmission,
  runOcr,
  autoScoreQuestion,
  autoScoreWholePaper,
  saveScore,
  loadCombinedMarkScheme,
} from "./marking/presentation/api-client";
export type { SaveScoreResult } from "./marking/presentation/api-client";
export {
  formatQuestionLabel,
  formatStatus,
  getQuestionState,
  getQuestionStateLabel,
  getQuestionStateTone,
  parseScoreEvidence,
  prioritizeQuestion,
} from "./marking/presentation/question-state";
export {
  clampMarks,
  clampTimeMinutes,
  estimatePaperTimeMinutes,
  estimateTargetMarksFromTimeMinutes,
  MAX_MARKS,
  MAX_TIME_MINUTES,
  MIN_MARKS,
  MIN_TIME_MINUTES,
  recommendedPaperCodes,
  resolveMinutesPerMark,
  resolveSubjectTopics,
} from "./builder/domain/rules";
export { SuccessModal } from "./builder/presentation/success-modal";
export { downloadMarkSchemePdfs } from "./builder/presentation/download-mark-schemes";
export type { GenerationResult } from "./builder/presentation/types";
