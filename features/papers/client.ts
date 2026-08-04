"use client";

export {
  requestMarkScheme,
  requestPaperGeneration,
  requestSavedPaper,
  requestSubjectDetail,
} from "./builder/presentation/api-client";
export {
  uploadResponsePage,
  importFinishedPaper,
  createMarkingSubmission,
  runOcr,
  autoScoreQuestion,
  autoScoreWholePaper,
  saveScore,
  loadCombinedMarkScheme,
} from "./marking/presentation/api-client";
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
