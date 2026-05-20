import type { SubjectTierKey } from "@/lib/paper-maker/combined-science";

export type PaperMakerSubjectKey = "aqa-geography" | "edexcel-combined-science" | "aqa-business";

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
  tiers: Array<{
    key: SubjectTierKey;
    label: string;
  }>;
};

export type PaperBuildTargetMode = "marks" | "time";

export const PAPER_MAKER_SUBJECTS: PaperMakerSubjectDefinition[] = [
  {
    key: "aqa-geography",
    label: "AQA Geography",
    boardLabel: "AQA",
    boardCode: "aqa",
    subjectSlug: "geography",
    coverTitle: "Geography",
    codeLabel: "8035",
    description: "Full topic selection and PDF generation are available now.",
    topicSelectionEnabled: true,
    generationEnabled: true,
    availabilityNote: "Ready to build papers.",
    recommendedMinutesPerMark: 1,
    paperOptions: [
      { code: "paper-1", label: "Physical Geography" },
      { code: "paper-2", label: "Human Geography" },
      { code: "paper-3", label: "Fieldwork and UK Challenges" },
    ],
    defaultPaperCodes: ["paper-1", "paper-2", "paper-3"],
    tiers: [],
  },
  {
    key: "aqa-business",
    label: "AQA Business",
    boardLabel: "AQA",
    boardCode: "aqa",
    subjectSlug: "business",
    coverTitle: "Business",
    codeLabel: "8132",
    description: "Generate AQA Business papers using the real numbered specification structure and source-page questions.",
    topicSelectionEnabled: true,
    generationEnabled: true,
    availabilityNote: "Ready to build by paper and topic.",
    recommendedMinutesPerMark: 1,
    paperOptions: [
      { code: "paper-1", label: "Paper 1" },
      { code: "paper-2", label: "Paper 2" },
    ],
    defaultPaperCodes: ["paper-1", "paper-2"],
    tiers: [],
  },
  {
    key: "edexcel-combined-science",
    label: "Edexcel Combined Science",
    boardLabel: "Edexcel",
    boardCode: "edexcel",
    subjectSlug: "combined-science",
    coverTitle: "Combined Science",
    codeLabel: "1SC0",
    description: "Generate real Edexcel Combined Science papers from tagged source pages, with Foundation and Higher routed end to end.",
    topicSelectionEnabled: true,
    generationEnabled: true,
    availabilityNote: "Ready to build by tier and topic.",
    recommendedMinutesPerMark: 1.15,
    paperOptions: [
      { code: "biology-1", label: "Biology Paper 1" },
      { code: "biology-2", label: "Biology Paper 2" },
      { code: "chemistry-1", label: "Chemistry Paper 1" },
      { code: "chemistry-2", label: "Chemistry Paper 2" },
      { code: "physics-1", label: "Physics Paper 1" },
      { code: "physics-2", label: "Physics Paper 2" },
    ],
    defaultPaperCodes: ["biology-1", "biology-2", "chemistry-1", "chemistry-2", "physics-1", "physics-2"],
    tiers: [
      { key: "foundation", label: "Foundation" },
      { key: "higher", label: "Higher" },
    ],
  },
];

export function getPaperMakerSubject(subjectKey: string | undefined) {
  return PAPER_MAKER_SUBJECTS.find((subject) => subject.key === subjectKey);
}

export function estimatePaperTimeMinutes(recommendedMinutesPerMark: number, totalMarks: number) {
  const rawMinutes = Math.max(15, Math.round(totalMarks * recommendedMinutesPerMark));
  return Math.max(15, Math.round(rawMinutes / 5) * 5);
}

export function estimateTargetMarksFromTimeMinutes(timeMinutes: number, benchmarkMinutesPerMark: number | null, fallbackMinutesPerMark: number) {
  const minutesPerMark = benchmarkMinutesPerMark && Number.isFinite(benchmarkMinutesPerMark) && benchmarkMinutesPerMark > 0
    ? benchmarkMinutesPerMark
    : fallbackMinutesPerMark;

  return Math.max(1, Math.min(200, Math.round(timeMinutes / minutesPerMark)));
}
