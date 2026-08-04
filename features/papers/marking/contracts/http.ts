import { z } from "zod";

export const submissionIdSchema = z.string().trim().min(1, "submissionId is required.");
export const questionKeySchema = z.string().trim().min(1, "questionKey is required.");

export const createSubmissionRequestSchema = z.object({
  savedPaperId: z.string().trim().min(1).optional(),
  boardCode: z.string().trim().min(1).optional(),
  subjectSlug: z.string().trim().min(1).optional(),
  subjectKey: z.string().trim().min(1).optional(),
  paperCode: z.string().trim().min(1).optional(),
  tier: z.enum(["none", "foundation", "higher"]).optional(),
  year: z.number().finite().transform(Math.round).optional(),
  session: z.string().trim().min(1).optional(),
  rubricVersion: z.string().trim().min(1).optional(),
  studentLabel: z.string().trim().min(1).optional(),
});

export const ocrRequestSchema = z.object({
  submissionId: submissionIdSchema,
  imageUrl: z.string().url().optional(),
  questionKey: questionKeySchema,
  questionNumber: z.string().trim().optional(),
  questionPartNumber: z.string().trim().optional(),
});

export const autoScoreRequestSchema = z.object({
  submissionId: submissionIdSchema,
  questionKey: questionKeySchema.optional(),
  scoreWholePaper: z.boolean().default(false),
}).superRefine((value, context) => {
  if (!value.scoreWholePaper && !value.questionKey) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["questionKey"], message: "questionKey is required." });
  }
});

export const scoreRequestSchema = z.object({
  submissionId: submissionIdSchema,
  questionKey: questionKeySchema,
  awardedMarks: z.number().finite().nonnegative(),
  maxMarks: z.number().finite().nonnegative(),
  confidence: z.number().finite().min(0).max(1).default(0),
  needsReview: z.boolean().default(false),
  rationale: z.string().trim().min(1, "rationale is required."),
  evidence: z.unknown().default({}),
  scorerProvider: z.string().trim().min(1).default("manual"),
  scorerModel: z.string().trim().min(1).default("manual"),
}).superRefine((value, context) => {
  if (value.awardedMarks > value.maxMarks) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["awardedMarks"], message: "awardedMarks cannot exceed maxMarks." });
  }
});

export type CreateSubmissionRequest = z.infer<typeof createSubmissionRequestSchema>;
export type OcrRequest = z.infer<typeof ocrRequestSchema>;
export type AutoScoreRequest = z.infer<typeof autoScoreRequestSchema>;
export type ScoreRequest = z.infer<typeof scoreRequestSchema>;
