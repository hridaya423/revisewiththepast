export type GcseBoardCode = "aqa" | "edexcel" | "ocr" | "eduqas" | "wjec" | "ccea";

export type ExamTier = "none" | "foundation" | "higher";

export type ExamSession = "january" | "june" | "november" | "unknown";

export type TierMode = "none" | "foundation_higher";

export type SubjectCategory =
  | "english"
  | "mathematics"
  | "science"
  | "humanities"
  | "languages"
  | "arts"
  | "technical"
  | "other";

export type GcseBoard = {
  code: GcseBoardCode;
  name: string;
};

export type PaperDefinition = {
  code: string;
  name: string;
  defaultDurationMinutes?: number;
  notes?: string;
};

export type SubjectBoardConfig = {
  boardCode: GcseBoardCode;
  qualificationTitle: string;
  tierMode: TierMode;
  papers: PaperDefinition[];
};

export type GcseSubject = {
  slug: string;
  name: string;
  category: SubjectCategory;
  boardConfigs: SubjectBoardConfig[];
};
