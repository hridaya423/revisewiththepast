import type { PaperMakerSubjectKey } from "./paper";

export type SubjectTierKey = "foundation" | "higher";

export type PaperOption = {
  code: string;
  label: string;
};

export type PaperMakerSubjectDefinition = {
  key: PaperMakerSubjectKey;
  label: string;
  boardLabel: string;
  boardCode: string;
  subjectSlug: string;
  coverTitle: string;
  codeLabel: string;
  description: string;
  topicSelectionEnabled: boolean;
  generationEnabled: boolean;
  availabilityNote: string;
  recommendedMinutesPerMark: number;
  paperOptions: PaperOption[];
  defaultPaperCodes: string[];
  tiers: Array<{ key: SubjectTierKey; label: string }>;
};

export type PaperBuildTargetMode = "marks" | "time";
