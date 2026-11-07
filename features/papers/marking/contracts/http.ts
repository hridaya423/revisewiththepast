import { z } from "zod";

export const convexIdSchema = z.string().trim().regex(/^[a-z0-9]+$/i, "Invalid id format.");
export const submissionIdSchema = convexIdSchema.min(1, "submissionId is required.");
export const questionKeySchema = z.string().trim().min(1, "questionKey is required.");

export const uploadMappingSchema = z.object({
  submissionId: submissionIdSchema,
  questionKeys: z.array(questionKeySchema.max(512)).min(1, "Choose at least one question for each page.").max(80),
  pageLabel: z.string().trim().max(120).optional(),
});

export const createSubmissionRequestSchema = z.object({
  savedPaperId: convexIdSchema.optional(),
  newAttempt: z.boolean().optional(),
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
  imageUrl: z.url().optional(),
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
  needsReview: z.boolean().default(false),
  rationale: z.string().trim().max(4000).default(""),
  evidence: z.unknown().default({}),
  /** Score revision the student was looking at; `null` when no score existed. */
  expectedUpdatedAt: z.number().int().nonnegative().nullable().optional(),
}).superRefine((value, context) => {
  if (value.awardedMarks > value.maxMarks) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["awardedMarks"], message: "awardedMarks cannot exceed maxMarks." });
  }
});

export type CreateSubmissionRequest = z.infer<typeof createSubmissionRequestSchema>;
export type OcrRequest = z.infer<typeof ocrRequestSchema>;
export type AutoScoreRequest = z.infer<typeof autoScoreRequestSchema>;
export type ScoreRequest = z.infer<typeof scoreRequestSchema>;
