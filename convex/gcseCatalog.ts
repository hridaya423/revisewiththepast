import type {
  GcseBoard,
  GcseBoardCode,
  GcseSubject,
  PaperDefinition,
  SubjectBoardConfig,
  TierMode,
} from "@/lib/gcse/types";

export const GCSE_BOARDS: GcseBoard[] = [
  { code: "aqa", name: "AQA" },
  { code: "edexcel", name: "Pearson Edexcel" },
  { code: "ocr", name: "OCR" },
];

const CORE_ENGLISH_BOARDS: GcseBoardCode[] = ["aqa", "edexcel", "ocr"];
const CORE_MATHS_BOARDS: GcseBoardCode[] = ["aqa", "edexcel"];
const CORE_SCIENCE_BOARDS: GcseBoardCode[] = ["aqa", "edexcel"];

function makeBoardConfigs(
  boardCodes: GcseBoardCode[],
  input: {
    qualificationTitle: string;
    tierMode: TierMode;
    papers: PaperDefinition[];
  },
): SubjectBoardConfig[] {
  return boardCodes.map((boardCode) => ({
    boardCode,
    qualificationTitle: input.qualificationTitle,
    tierMode: input.tierMode,
    papers: input.papers,
  }));
}

export const GCSE_SUBJECTS: GcseSubject[] = [
  {
    slug: "english-language",
    name: "English Language",
    category: "english",
    boardConfigs: makeBoardConfigs(CORE_ENGLISH_BOARDS, {
      qualificationTitle: "GCSE English Language",
      tierMode: "none",
      papers: [
        { code: "paper-1", name: "Paper 1" },
        { code: "paper-2", name: "Paper 2" },
      ],
    }),
  },
  {
    slug: "english-literature",
    name: "English Literature",
    category: "english",
    boardConfigs: makeBoardConfigs(CORE_ENGLISH_BOARDS, {
      qualificationTitle: "GCSE English Literature",
      tierMode: "none",
      papers: [
        { code: "paper-1", name: "Paper 1" },
        { code: "paper-2", name: "Paper 2" },
      ],
    }),
  },
  {
    slug: "mathematics",
    name: "Mathematics",
    category: "mathematics",
    boardConfigs: makeBoardConfigs(CORE_MATHS_BOARDS, {
      qualificationTitle: "GCSE Mathematics",
      tierMode: "foundation_higher",
      papers: [
        { code: "paper-1", name: "Paper 1" },
        { code: "paper-2", name: "Paper 2" },
        { code: "paper-3", name: "Paper 3" },
      ],
    }),
  },
  {
    slug: "combined-science",
    name: "Combined Science",
    category: "science",
    boardConfigs: makeBoardConfigs(["aqa", "edexcel"], {
      qualificationTitle: "GCSE Combined Science",
      tierMode: "foundation_higher",
      papers: [
        { code: "biology-1", name: "Biology Paper 1" },
        { code: "biology-2", name: "Biology Paper 2" },
        { code: "chemistry-1", name: "Chemistry Paper 1" },
        { code: "chemistry-2", name: "Chemistry Paper 2" },
        { code: "physics-1", name: "Physics Paper 1" },
        { code: "physics-2", name: "Physics Paper 2" },
      ],
    }),
  },
  {
    slug: "biology",
    name: "Biology",
    category: "science",
    boardConfigs: makeBoardConfigs(CORE_SCIENCE_BOARDS, {
      qualificationTitle: "GCSE Biology",
      tierMode: "foundation_higher",
      papers: [
        { code: "paper-1", name: "Paper 1" },
        { code: "paper-2", name: "Paper 2" },
      ],
    }),
  },
  {
    slug: "chemistry",
    name: "Chemistry",
    category: "science",
    boardConfigs: makeBoardConfigs(CORE_SCIENCE_BOARDS, {
      qualificationTitle: "GCSE Chemistry",
      tierMode: "foundation_higher",
      papers: [
        { code: "paper-1", name: "Paper 1" },
        { code: "paper-2", name: "Paper 2" },
      ],
    }),
  },
  {
    slug: "physics",
    name: "Physics",
    category: "science",
    boardConfigs: makeBoardConfigs(CORE_SCIENCE_BOARDS, {
      qualificationTitle: "GCSE Physics",
      tierMode: "foundation_higher",
      papers: [
        { code: "paper-1", name: "Paper 1" },
        { code: "paper-2", name: "Paper 2" },
      ],
    }),
  },
  {
    slug: "geography",
    name: "Geography",
    category: "humanities",
    boardConfigs: makeBoardConfigs(["aqa", "edexcel"], {
      qualificationTitle: "GCSE Geography",
      tierMode: "none",
      papers: [
        { code: "physical", name: "Physical Geography" },
        { code: "human", name: "Human Geography" },
        { code: "fieldwork", name: "Fieldwork and UK Challenges" },
      ],
    }),
  },
  {
    slug: "history",
    name: "History",
    category: "humanities",
    boardConfigs: makeBoardConfigs(["aqa", "edexcel"], {
      qualificationTitle: "GCSE History",
      tierMode: "none",
      papers: [
        { code: "paper-1", name: "Paper 1" },
        { code: "paper-2", name: "Paper 2" },
      ],
    }),
  },
  {
    slug: "french",
    name: "French",
    category: "languages",
    boardConfigs: makeBoardConfigs(["aqa", "edexcel"], {
      qualificationTitle: "GCSE French",
      tierMode: "foundation_higher",
      papers: [
        { code: "listening", name: "Listening" },
        { code: "speaking", name: "Speaking" },
        { code: "reading", name: "Reading" },
        { code: "writing", name: "Writing" },
      ],
    }),
  },
  {
    slug: "spanish",
    name: "Spanish",
    category: "languages",
    boardConfigs: makeBoardConfigs(["aqa", "edexcel"], {
      qualificationTitle: "GCSE Spanish",
      tierMode: "foundation_higher",
      papers: [
        { code: "listening", name: "Listening" },
        { code: "speaking", name: "Speaking" },
        { code: "reading", name: "Reading" },
        { code: "writing", name: "Writing" },
      ],
    }),
  },
  {
    slug: "computer-science",
    name: "Computer Science",
    category: "technical",
    boardConfigs: makeBoardConfigs(["aqa", "edexcel", "ocr"], {
      qualificationTitle: "GCSE Computer Science",
      tierMode: "none",
      papers: [
        { code: "paper-1", name: "Computer Systems" },
        { code: "paper-2", name: "Computational Thinking" },
      ],
    }),
  },
  {
    slug: "business",
    name: "Business",
    category: "technical",
    boardConfigs: makeBoardConfigs(["aqa", "edexcel"], {
      qualificationTitle: "GCSE Business",
      tierMode: "none",
      papers: [
        { code: "paper-1", name: "Business Activity" },
        { code: "paper-2", name: "Influences on Business" },
      ],
    }),
  },
  {
    slug: "economics",
    name: "Economics",
    category: "technical",
    boardConfigs: makeBoardConfigs(["aqa"], {
      qualificationTitle: "GCSE Economics",
      tierMode: "none",
      papers: [
        { code: "paper-1", name: "How Markets Work" },
        { code: "paper-2", name: "How the Economy Works" },
      ],
    }),
  },
  {
    slug: "psychology",
    name: "Psychology",
    category: "other",
    boardConfigs: makeBoardConfigs(["aqa", "ocr"], {
      qualificationTitle: "GCSE Psychology",
      tierMode: "none",
      papers: [
        { code: "paper-1", name: "Paper 1" },
        { code: "paper-2", name: "Paper 2" },
      ],
    }),
  },
  {
    slug: "sociology",
    name: "Sociology",
    category: "other",
    boardConfigs: makeBoardConfigs(["aqa"], {
      qualificationTitle: "GCSE Sociology",
      tierMode: "none",
      papers: [
        { code: "paper-1", name: "Paper 1" },
        { code: "paper-2", name: "Paper 2" },
      ],
    }),
  },
];
