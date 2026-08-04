export { generatePaper, buildGenerationHeaders } from "./builder/application/generate-paper";
export {
  parseGeneratePaperRequest,
  type GeneratePaperRequest,
} from "./builder/contracts/generate-paper";
export { saveGeneratedPaper } from "./builder/application/save-generated";
export { getSubjectDetail } from "./builder/application/subject-detail";
export { getPaperMakerPageData } from "./builder/application/page-data";
export { PAPER_MAKER_SUBJECTS } from "./builder/domain/subjects";
export { generateMarkScheme } from "./marking/application/generate-mark-scheme";
export { generateMarkSchemeRequestSchema, type GenerateMarkSchemeRequest } from "./marking/contracts/mark-scheme";

export { createSubmission, getSubmission } from "./marking/application/submissions";
export { runQuestionOcr } from "./marking/application/ocr";
export { autoScoreSubmission, getCombinedMarkScheme, saveManualScore } from "./marking/application/scoring";
export { uploadResponsePage } from "./marking/application/uploads";
export { importFinishedPaper } from "./marking/application/import";
export { getMarkingDashboardData } from "./marking/application/dashboard";
export {
  autoScoreRequestSchema,
  createSubmissionRequestSchema,
  ocrRequestSchema,
  scoreRequestSchema,
  type AutoScoreRequest,
  type CreateSubmissionRequest,
  type OcrRequest,
  type ScoreRequest,
} from "./marking/contracts/http";
