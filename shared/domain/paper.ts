import type { ExamSession, ExamTier, GcseBoardCode } from "./exam";
import type { BoundingBox, RegionSpan } from "./geometry";
import type { TopicId } from "./topic";

export type { BoundingBox, RegionSpan } from "./geometry";
export type { TopicTreeNode, TopicTreeNodeWithCounts } from "./topic";

export type PaperMakerSubjectKey =
  | "aqa-geography"
  | "aqa-business"
  | "aqa-english-language"
  | "aqa-english-literature"
  | "edexcel-business"
  | "edexcel-combined-science"
  | "edexcel-biology"
  | "edexcel-chemistry"
  | "edexcel-physics"
  | "edexcel-french-reading"
  | "edexcel-mathematics-higher"
  | "ocr-computer-science";

export type PaperIdentity = {
  boardCode: GcseBoardCode | string;
  subjectSlug: string;
  paperCode: string;
  year: number | null;
  session: ExamSession | string | null;
  tier: ExamTier;
};

export type SourcePageAsset = {
  sourceRelativePath: string;
  pageNumber: number;
  cdnUrl: string;
  fileName: string;
  relativePath: string;
};

export type QuestionBankPart = {
  partKey: string;
  unitKey: string;
  taggedPaperId: string;
  sourceRelativePath: string;
  questionPaperCdnUrl: string | null;
  questionPaperFileName: string | null;
  pageAssetCdnUrls: Array<{ pageNumber: number; cdnUrl: string | null }>;
  boardCode: string;
  subjectSlug: string;
  paperCode: string;
  year: number | null;
  session: string | null;
  questionId: string;
  questionNumber: string;
  questionPartNumber: string | null;
  questionPath?: string[];
  sectionCode: string | null;
  sectionName: string | null;
  marks: number | null;
  sourceTotalMarks?: number | null;
  marksValidated?: "validated" | "mismatch" | "unknown";
  canonicalLeaf: string;
  promptText: string;
  contextText: string | null;
  pageNumber: number;
  pageNumbers: number[];
  bbox: BoundingBox | null;
  regionSpans?: RegionSpan[] | null;
  stemSpans?: RegionSpan[] | null;
  referencedFigures?: string[];
  regionVersion?: string;
  sourceMode: string;
  assetIds: string[];
  questionType?: string | null;
  isChoiceQuestion?: boolean;
  choiceGroupId?: string | null;
  choiceGroupType?: string | null;
  choiceSiblingQuestionIds?: string[];
};

export type QuestionUnitPage = {
  pageNumber: number;
  parts: QuestionBankPart[];
  bboxUnion: BoundingBox | null;
};

export type QuestionUnit = {
  unitKey: string;
  groupUnitKey: string;
  sourceQuestionKey: string;
  sourceRelativePath: string;
  questionPaperCdnUrl: string | null;
  questionPaperFileName: string | null;
  boardCode: string;
  subjectSlug: string;
  paperCode: string;
  year: number | null;
  session: string | null;
  questionNumber: string;
  questionPath?: string[];
  sectionCode: string | null;
  sectionName: string | null;
  totalMarks: number;
  sourceTotalMarks?: number | null;
  marksValidated?: "validated" | "mismatch" | "unknown";
  canonicalLeafs: TopicId[];
  parts: QuestionBankPart[];
  pages: QuestionUnitPage[];
};

export type QuestionMixProfile = "balanced" | "short-form" | "long-form";
