import { z } from "zod";

export const paperTierSchema = z.enum(["foundation", "higher"]);
export const questionMixSchema = z.enum(["balanced", "short-form", "long-form"]);

export const generatePaperRequestSchema = z.object({
  subjectKey: z.string().trim().min(1).default("aqa-geography"),
  subjectTier: paperTierSchema.optional(),
  selectedTopicNodeIds: z.array(z.string().trim().min(1)).default([]),
  targetMarks: z.number().finite().transform((value) => Math.max(1, Math.min(200, Math.round(value)))).default(40),
  questionMix: questionMixSchema.default("balanced"),
  timeMinutes: z.number().finite().transform((value) => Math.max(15, Math.min(300, Math.round(value)))).optional(),
  targetMode: z.enum(["marks", "time"]).default("marks"),
  paperCodes: z.array(z.string().trim().min(1)).default([]),
  maxQuestions: z.number().finite().transform((value) => Math.max(1, Math.min(40, Math.round(value)))).optional(),
  excludeSourceQuestionKeys: z.array(z.string()).default([]),
  remainingPaperCount: z.number().finite().transform((value) => Math.max(1, Math.min(3, Math.round(value)))).default(1),
  priorSelectedUnitMarks: z.array(z.number().finite()).default([]),
  priorPaperCount: z.number().finite().transform((value) => Math.max(0, Math.min(2, Math.round(value)))).default(0),
  priorCoveredLeafTopicIds: z.array(z.string()).default([]),
  selectAllTopics: z.boolean().default(false),
  seed: z.number().finite().optional(),
});

export type GeneratePaperRequest = z.infer<typeof generatePaperRequestSchema>;

export function parseGeneratePaperRequest(input: unknown) {
  return generatePaperRequestSchema.safeParse(input);
}
