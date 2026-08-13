import * as z from "zod/v4";

import type { TopicTreeNodeWithCounts } from "@/shared/domain/topic";

const subjectTierSchema = z.enum(["foundation", "higher"]);
const questionMixSchema = z.enum(["balanced", "short-form", "long-form"]);

type TopicOutput = {
  id: string;
  label: string;
  questionUnitCount: number;
  children?: TopicOutput[];
};

const topicOutputSchema: z.ZodType<TopicOutput> = z.object({
  id: z.string(),
  label: z.string(),
  questionUnitCount: z.number(),
  children: z.lazy(() => z.array(topicOutputSchema)).optional(),
});

const topicSourceSchema: z.ZodType<TopicTreeNodeWithCounts> = z.object({
  id: z.string(),
  label: z.string(),
  leafTopicIds: z.array(z.string()),
  questionUnitCount: z.number(),
  children: z.lazy(() => z.array(topicSourceSchema)).optional(),
});

const paperOptionSchema = z.object({
  code: z.string(),
  label: z.string(),
});

const tierSummarySchema = z.object({
  key: subjectTierSchema,
  label: z.string(),
  taggedQuestionUnits: z.number(),
});

export const listSubjectsOutputSchema = z.object({
  nextTool: z.literal("get_subject_catalog"),
  subjects: z.array(z.object({
    key: z.string(),
    label: z.string(),
    board: z.string(),
    code: z.string(),
    tiers: z.array(z.object({ key: subjectTierSchema, label: z.string() })),
    paperOptions: z.array(paperOptionSchema),
    defaultPaperCodes: z.array(z.string()),
  })),
});

export const subjectCatalogInputSchema = z.object({
  subjectKey: z.string().trim().min(1).describe("One key returned by list_subjects."),
  subjectTier: subjectTierSchema.optional().describe("Required for tiered subjects when selecting a tier-specific topic tree."),
});

export const subjectCatalogOutputSchema = z.object({
  nextTool: z.literal("generate_paper_bundle"),
  key: z.string(),
  label: z.string(),
  board: z.string(),
  code: z.string(),
  description: z.string(),
  availabilityNote: z.string(),
  taggedQuestionUnits: z.number(),
  benchmarkMinutesPerMark: z.number().nullable(),
  paperOptions: z.array(paperOptionSchema),
  defaultPaperCodes: z.array(z.string()),
  tiers: z.array(tierSummarySchema),
  topics: z.array(topicOutputSchema),
  generation: z.object({
    subjectKey: z.string(),
    subjectTier: subjectTierSchema.optional(),
    defaultPaperCodes: z.array(z.string()),
    requiresExplicitSelectAll: z.literal(true),
  }),
  detailLoaded: z.literal(true),
});

export const generatePaperBundleInputSchema = z.object({
  subjectKey: z.string().trim().min(1).describe("Subject key returned by list_subjects."),
  subjectTier: subjectTierSchema.optional().describe("Foundation or higher when the subject supports tiers."),
  topicIds: z.array(z.string().trim().min(1)).max(100).default([]).describe("One or more topic IDs from get_subject_catalog. Provide these for focused generation."),
  selectAllTopics: z.boolean().optional().describe("Set true to deliberately select the complete available topic bank when topicIds is empty."),
  paperCodes: z.array(z.string().trim().min(1)).max(6).default([]).describe("Paper codes from list_subjects. Defaults to the subject's configured papers."),
  targetMarks: z.number().finite().int().min(1).max(200).default(40).describe("Target paper marks."),
  targetMode: z.enum(["marks", "time"]).default("marks").describe("Build toward targetMarks or timeMinutes."),
  timeMinutes: z.number().finite().int().min(15).max(300).optional().describe("Required when targetMode is time."),
  questionMix: questionMixSchema.default("balanced").describe("Prefer balanced, short-form, or long-form questions."),
  maxQuestions: z.number().finite().int().min(1).max(40).optional().describe("Optional upper bound on selected questions."),
  seed: z.number().finite().int().min(-2_147_483_648).max(4_294_967_295).optional().describe("Optional seed for reproducible question selection."),
});

export const artifactOutputSchema = z.object({
  fileName: z.string(),
  url: z.url(),
  size: z.number().int().positive(),
  mimeType: z.literal("application/pdf"),
});

export const paperBundleOutputSchema = z.object({
  bundleId: z.string(),
  subjectKey: z.string(),
  totalMarks: z.number(),
  timeMinutes: z.number(),
  questionCount: z.number().int().nonnegative(),
  coveredTopicIds: z.array(z.string()),
  paper: artifactOutputSchema,
  markScheme: artifactOutputSchema.nullable(),
  warnings: z.array(z.string()),
  expiresAt: z.iso.datetime(),
});

export type GeneratePaperBundleInput = z.infer<typeof generatePaperBundleInputSchema>;
export type PaperBundleOutput = z.infer<typeof paperBundleOutputSchema>;
export type SubjectCatalogOutput = z.infer<typeof subjectCatalogOutputSchema>;
export type ListSubjectsOutput = z.infer<typeof listSubjectsOutputSchema>;
export type ArtifactOutput = z.infer<typeof artifactOutputSchema>;

export type McpTopic = TopicOutput;

export function compactTopicTree(value: unknown): McpTopic[] {
  const source = z.array(topicSourceSchema).parse(value);
  const compact = (node: TopicTreeNodeWithCounts): McpTopic => ({
    id: node.id,
    label: node.label,
    questionUnitCount: node.questionUnitCount,
    ...(node.children ? { children: node.children.map(compact) } : {}),
  });
  return source.map(compact);
}
