export type GenerationResult = {
  paperCount: number;
  questionCount: number;
  totalMarks: number;
  coveredTopics: number;
  timeMinutes: number;
  savedPaperIds: string[];
  markSchemeUnitKeys: string[][];
  saveWarning?: string | null;
  markSchemeGenerated?: boolean;
  markSchemeWarning?: string | null;
};
