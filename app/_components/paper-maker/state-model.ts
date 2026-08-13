import type { QuestionMixProfile } from "@/shared/domain/paper";
import type { SubjectTierKey } from "@/shared/domain/subject";
import type { PaperMakerSubjectKey } from "@/shared/domain/paper";
import type { TopicTreeNodeWithCounts } from "@/shared/domain/topic";
import type { GenerationResult } from "@/features/papers/client";

export type WorkspaceSubjectOption = {
  key: PaperMakerSubjectKey;
  label: string;
  boardLabel: string;
  description: string;
  taggedQuestionUnits: number;
  topicSelectionEnabled: boolean;
  generationEnabled: boolean;
  availabilityNote: string;
  recommendedMinutesPerMark: number;
  benchmarkMinutesPerMark: number | null;
  paperOptions: { code: string; label: string }[];
  defaultPaperCodes: string[];
  topics: TopicTreeNodeWithCounts[];
  topicsByTier?: Partial<Record<SubjectTierKey, TopicTreeNodeWithCounts[]>>;
  tiers: { key: SubjectTierKey; label: string; taggedQuestionUnits: number }[];
  detailLoaded: boolean;
};

export function mergeSubjectDetail(
  subjects: WorkspaceSubjectOption[],
  detail: Pick<WorkspaceSubjectOption, "key" | "taggedQuestionUnits" | "benchmarkMinutesPerMark" | "topics" | "topicsByTier" | "tiers" | "detailLoaded">,
) {
  return subjects.map((subject) => subject.key === detail.key ? { ...subject, ...detail } : subject);
}

export type BuilderSelectionState = {
  selectedSubjectKey: PaperMakerSubjectKey;
  selectedLeafIds: Set<string>;
  selectedPaperCodes: Set<string>;
  paperSourcesCustomized: boolean;
  selectedTier: SubjectTierKey;
  targetMarks: number;
  timeMinutes: number;
  targetMode: "marks" | "time";
  questionMix: QuestionMixProfile;
};

export type BuilderSelectionAction =
  | { type: "subject-changed"; subjectKey: PaperMakerSubjectKey; tier: SubjectTierKey; paperCodes: Set<string>; targetMarks: number; timeMinutes: number }
  | { type: "tier-changed"; tier: SubjectTierKey; leafIds: Set<string> }
  | { type: "marks-changed"; targetMarks: number; timeMinutes: number }
  | { type: "time-changed"; targetMarks: number; timeMinutes: number }
  | { type: "leaf-selection-changed"; leafIds: Set<string> }
  | { type: "leaf-selection-toggled"; leafIds: string[] }
  | { type: "leaf-selection-removed"; leafIds: string[] }
  | { type: "question-mix-changed"; questionMix: QuestionMixProfile }
  | { type: "paper-codes-changed"; paperCodes: Set<string>; customized: boolean }
  | { type: "paper-sources-reset"; customized: boolean };

export function builderSelectionReducer(state: BuilderSelectionState, action: BuilderSelectionAction): BuilderSelectionState {
  switch (action.type) {
    case "subject-changed":
      return { ...state, selectedSubjectKey: action.subjectKey, selectedTier: action.tier, selectedLeafIds: new Set(), selectedPaperCodes: new Set(action.paperCodes), paperSourcesCustomized: false, targetMarks: action.targetMarks, timeMinutes: action.timeMinutes };
    case "tier-changed":
      return { ...state, selectedTier: action.tier, selectedLeafIds: new Set(action.leafIds) };
    case "marks-changed":
      return { ...state, targetMarks: action.targetMarks, timeMinutes: action.timeMinutes, targetMode: "marks" };
    case "time-changed":
      return { ...state, targetMarks: action.targetMarks, timeMinutes: action.timeMinutes, targetMode: "time" };
    case "leaf-selection-changed": return { ...state, selectedLeafIds: new Set(action.leafIds) };
    case "leaf-selection-toggled": {
      const selectedLeafIds = new Set(state.selectedLeafIds);
      const allSelected = action.leafIds.every((leafId) => selectedLeafIds.has(leafId));
      for (const leafId of action.leafIds) {
        if (allSelected) selectedLeafIds.delete(leafId);
        else selectedLeafIds.add(leafId);
      }
      return { ...state, selectedLeafIds };
    }
    case "leaf-selection-removed": {
      const selectedLeafIds = new Set(state.selectedLeafIds);
      action.leafIds.forEach((leafId) => selectedLeafIds.delete(leafId));
      return { ...state, selectedLeafIds };
    }
    case "question-mix-changed": return { ...state, questionMix: action.questionMix };
    case "paper-codes-changed": return { ...state, selectedPaperCodes: new Set(action.paperCodes), paperSourcesCustomized: action.customized };
    case "paper-sources-reset": return { ...state, paperSourcesCustomized: action.customized };
  }
}

export type BuilderUiState = {
  error: string | null;
  paperCount: number;
  generationMode: "paper" | "paper-and-mark-scheme" | null;
  result: GenerationResult | null;
  topicSearch: string;
  activeTopicGroupId: string | null;
  hasChosenSubject: boolean;
  builderStage: "subject" | "topics" | "paper";
  stageDirection: "forward" | "back";
  activeBoardLabel: string;
};
