import { z } from "zod";

import type { BuilderSelectionState, WorkspaceSubjectOption } from "./state-model";
import type { BuilderStage } from "./builder-progress";
import { flattenLeafIds } from "./topic-tree-model";

export const BUILDER_DRAFT_KEY = "revise:builder:v1";
export const BUILDER_DRAFT_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

export type BuilderDraft = {
  selection: BuilderSelectionState;
  paperCount: number;
  stage: BuilderStage;
};

const draftSchema = z.object({
  version: z.literal(1),
  updatedAt: z.number().finite(),
  subjectKey: z.string(),
  tier: z.enum(["foundation", "higher"]),
  leafIds: z.array(z.string()).max(2000),
  paperCodes: z.array(z.string()).max(50),
  paperSourcesCustomized: z.boolean(),
  targetMarks: z.number().int().min(1).max(200),
  timeMinutes: z.number().int().min(15).max(300),
  targetMode: z.enum(["marks", "time"]),
  questionMix: z.enum(["balanced", "short-form", "long-form"]),
  paperCount: z.number().int().min(1).max(3),
  stage: z.enum(["subject", "topics", "paper"]),
});

export function parseBuilderDraft(raw: string | null, subjects: WorkspaceSubjectOption[], now = Date.now()): BuilderDraft | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = draftSchema.safeParse(value);
  if (!parsed.success) return null;
  const draft = parsed.data;
  if (draft.updatedAt > now || now - draft.updatedAt > BUILDER_DRAFT_MAX_AGE) return null;
  const subject = subjects.find((entry) => entry.key === draft.subjectKey && entry.generationEnabled);
  if (!subject) return null;
  const selectedTier = subject.tiers.find((tier) => tier.key === draft.tier)?.key ?? subject.tiers[0]?.key ?? "foundation";
  const tierChanged = subject.tiers.length > 0 && selectedTier !== draft.tier;
  const topics = subject.tiers.length ? subject.topicsByTier?.[selectedTier] ?? [] : subject.topics;
  const available = new Set(flattenLeafIds(topics));
  const leafIds = tierChanged ? [] : draft.leafIds.filter((id) => !subject.detailLoaded || available.has(id));
  const paperCodes = draft.paperCodes.filter((code) => subject.paperOptions.some((paper) => paper.code === code));
  const stage = draft.stage === "paper" && subject.topicSelectionEnabled && leafIds.length === 0 ? "topics" : draft.stage;
  return {
    selection: {
      selectedSubjectKey: subject.key,
      selectedTier,
      selectedLeafIds: new Set(leafIds),
      selectedPaperCodes: new Set(paperCodes),
      paperSourcesCustomized: draft.paperSourcesCustomized,
      targetMarks: draft.targetMarks,
      timeMinutes: draft.timeMinutes,
      targetMode: draft.targetMode,
      questionMix: draft.questionMix,
    },
    paperCount: draft.paperCount,
    stage: !subject.topicSelectionEnabled && stage === "topics" ? "paper" : stage,
  };
}

export function serializeBuilderDraft(draft: BuilderDraft, now = Date.now()) {
  const { selection } = draft;
  return JSON.stringify({
    version: 1,
    updatedAt: now,
    subjectKey: selection.selectedSubjectKey,
    tier: selection.selectedTier,
    leafIds: Array.from(selection.selectedLeafIds),
    paperCodes: Array.from(selection.selectedPaperCodes),
    paperSourcesCustomized: selection.paperSourcesCustomized,
    targetMarks: selection.targetMarks,
    timeMinutes: selection.timeMinutes,
    targetMode: selection.targetMode,
    questionMix: selection.questionMix,
    paperCount: draft.paperCount,
    stage: draft.stage,
  });
}
