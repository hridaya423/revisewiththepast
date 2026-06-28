import type { SubjectTierKey } from "@/lib/paper-maker/combined-science";

export type PaperMakerSubjectKey = "aqa-geography" | "aqa-business" | "aqa-english-language" | "aqa-english-literature" | "edexcel-business" | "edexcel-combined-science" | "edexcel-biology" | "edexcel-chemistry" | "edexcel-physics" | "edexcel-french-reading" | "edexcel-mathematics-higher" | "ocr-computer-science";

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
    key: "aqa-english-language",
    label: "AQA English Language",
    boardLabel: "AQA",
    boardCode: "aqa",
    subjectSlug: "english-language",
    coverTitle: "English Language",
    codeLabel: "8700",
    description: "Generate AQA English Language papers from tagged reading and writing source-page questions.",
    topicSelectionEnabled: true,
    generationEnabled: true,
    availabilityNote: "Ready to build by paper and question type.",
    recommendedMinutesPerMark: 1.3125,
    paperOptions: [
      { code: "paper-1", label: "Paper 1: Creative Reading and Writing" },
      { code: "paper-2", label: "Paper 2: Writers' Viewpoints and Perspectives" },
    ],
    defaultPaperCodes: ["paper-1", "paper-2"],
    tiers: [],
  },
  {
    key: "aqa-english-literature",
    label: "AQA English Literature",
    boardLabel: "AQA",
    boardCode: "aqa",
    subjectSlug: "english-literature",
    coverTitle: "English Literature",
    codeLabel: "8702",
    description: "Generate AQA English Literature papers from tagged source-page questions and set-text topics.",
    topicSelectionEnabled: true,
    generationEnabled: true,
    availabilityNote: "Ready to build by paper and topic.",
    recommendedMinutesPerMark: 1.5,
    paperOptions: [
      { code: "paper-1", label: "Paper 1: Shakespeare and the 19th-century novel" },
      { code: "paper-2", label: "Paper 2: Modern texts and poetry" },
    ],
    defaultPaperCodes: ["paper-1", "paper-2"],
    tiers: [],
  },
  {
    key: "edexcel-business",
    label: "Edexcel Business",
    boardLabel: "Edexcel",
    boardCode: "edexcel",
    subjectSlug: "business",
    coverTitle: "Business",
    codeLabel: "1BS0",
    description: "Generate Edexcel Business papers using tagged source-page questions and the Edexcel topic structure.",
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
  {
    key: "edexcel-biology",
    label: "Edexcel Biology",
    boardLabel: "Edexcel",
    boardCode: "edexcel",
    subjectSlug: "biology",
    coverTitle: "Biology",
    codeLabel: "1BI0",
    description: "Generate Edexcel Biology Higher papers from tagged source pages by topic.",
    topicSelectionEnabled: true,
    generationEnabled: true,
    availabilityNote: "Higher tier is ready to build by topic.",
    recommendedMinutesPerMark: 1.15,
    paperOptions: [
      { code: "paper-1", label: "Paper 1" },
      { code: "paper-2", label: "Paper 2" },
    ],
    defaultPaperCodes: ["paper-1", "paper-2"],
    tiers: [
      { key: "higher", label: "Higher" },
    ],
  },
  {
    key: "edexcel-chemistry",
    label: "Edexcel Chemistry",
    boardLabel: "Edexcel",
    boardCode: "edexcel",
    subjectSlug: "chemistry",
    coverTitle: "Chemistry",
    codeLabel: "1CH0",
    description: "Generate Edexcel Chemistry Foundation papers from tagged source pages by topic.",
    topicSelectionEnabled: true,
    generationEnabled: true,
    availabilityNote: "Foundation tier is ready to build by topic.",
    recommendedMinutesPerMark: 1.15,
    paperOptions: [
      { code: "paper-1", label: "Paper 1" },
      { code: "paper-2", label: "Paper 2" },
    ],
    defaultPaperCodes: ["paper-1", "paper-2"],
    tiers: [
      { key: "foundation", label: "Foundation" },
    ],
  },
  {
    key: "edexcel-physics",
    label: "Edexcel Physics",
    boardLabel: "Edexcel",
    boardCode: "edexcel",
    subjectSlug: "physics",
    coverTitle: "Physics",
    codeLabel: "1PH0",
    description: "Generate Edexcel Physics papers from tagged source pages by tier and topic.",
    topicSelectionEnabled: true,
    generationEnabled: false,
    availabilityNote: "Covered by Combined Science (physics papers).",
    recommendedMinutesPerMark: 1.15,
    paperOptions: [
      { code: "paper-1", label: "Paper 1" },
      { code: "paper-2", label: "Paper 2" },
    ],
    defaultPaperCodes: ["paper-1", "paper-2"],
    tiers: [
      { key: "foundation", label: "Foundation" },
      { key: "higher", label: "Higher" },
    ],
  },
  {
    key: "edexcel-french-reading",
    label: "Edexcel French Reading",
    boardLabel: "Edexcel",
    boardCode: "edexcel",
    subjectSlug: "french",
    coverTitle: "French",
    codeLabel: "1FR0",
    description: "Generate Edexcel French reading papers from tagged source-page questions by tier and topic.",
    topicSelectionEnabled: true,
    generationEnabled: true,
    availabilityNote: "Reading papers are ready to build by tier and topic.",
    recommendedMinutesPerMark: 1.05,
    paperOptions: [
      { code: "reading", label: "Paper 3: Reading" },
    ],
    defaultPaperCodes: ["reading"],
    tiers: [
      { key: "foundation", label: "Foundation" },
      { key: "higher", label: "Higher" },
    ],
  },
  {
    key: "edexcel-mathematics-higher",
    label: "Edexcel Maths Higher",
    boardLabel: "Edexcel",
    boardCode: "edexcel",
    subjectSlug: "mathematics",
    coverTitle: "Mathematics",
    codeLabel: "1MA1",
    description: "Generate Edexcel GCSE Maths Higher papers from tagged source pages and specification topics.",
    topicSelectionEnabled: true,
    generationEnabled: true,
    availabilityNote: "Ready to build Higher papers by topic.",
    recommendedMinutesPerMark: 1.125,
    paperOptions: [
      { code: "paper-1", label: "Paper 1 (Non-calculator)" },
      { code: "paper-2", label: "Paper 2 (Calculator)" },
      { code: "paper-3", label: "Paper 3 (Calculator)" },
    ],
    defaultPaperCodes: ["paper-1", "paper-2", "paper-3"],
    tiers: [],
  },
  {
    key: "ocr-computer-science",
    label: "OCR Computer Science",
    boardLabel: "OCR",
    boardCode: "ocr",
    subjectSlug: "computer-science",
    coverTitle: "Computer Science",
    codeLabel: "J277",
    description: "Generate OCR Computer Science papers from tagged source-page questions and J277 topics.",
    topicSelectionEnabled: true,
    generationEnabled: true,
    availabilityNote: "Ready to build by paper and topic.",
    recommendedMinutesPerMark: 1.2,
    paperOptions: [
      { code: "paper-1", label: "Component 01: Computer systems" },
      { code: "paper-2", label: "Component 02: Computational thinking, algorithms and programming" },
    ],
    defaultPaperCodes: ["paper-1", "paper-2"],
    tiers: [],
  },
];

export function getPaperMakerSubject(subjectKey: string | undefined) {
  return PAPER_MAKER_SUBJECTS.find((subject) => subject.key === subjectKey);
}

export type CoverExamContext = {
  materials: string[];
  instructions: string[];
};

const GENERIC_COVER_INSTRUCTIONS = [
  "• Fill in the boxes at the top of this page.",
  "• Answer all questions in the spaces provided.",
  "• Do all rough work in this booklet.",
  "• If you need extra space, use additional paper and clearly label your answers.",
];

const PEN_LINE = "• a black ink or black ball-point pen";

export function getCoverExamContext(
  subject: PaperMakerSubjectDefinition,
  selectedPapers: PaperOption[],
): CoverExamContext {
  const instructions = [...GENERIC_COVER_INSTRUCTIONS];

  switch (subject.subjectSlug) {
    case "mathematics": {
      const calculatorAllowed = selectedPapers.some(
        (paper) => /calculator/i.test(paper.label) && !/non[\s-]*calculator/i.test(paper.label),
      );
      const materials = [
        "For this paper you must have:",
        PEN_LINE,
        "• a pencil, an eraser and a ruler graduated in centimetres and millimetres",
        "• a pair of compasses and a protractor",
      ];
      if (calculatorAllowed) materials.push("• a scientific or graphical calculator");
      materials.push("Tracing paper may be used.");
      if (!calculatorAllowed) materials.push("You must not use a calculator.");
      return { materials, instructions };
    }
    case "computer-science":
      return {
        materials: [
          "For this paper you must have:",
          `${PEN_LINE}.`,
          "You are not allowed to use a calculator.",
        ],
        instructions,
      };
    case "english-language":
      return {
        materials: ["For this paper you must have:", `${PEN_LINE}.`],
        instructions,
      };
    case "english-literature":
      return {
        materials: ["For this paper you must have:", `${PEN_LINE}.`],
        instructions: [...instructions, "• You must not use a dictionary or thesaurus."],
      };
    case "french":
      return {
        materials: ["For this paper you must have:", `${PEN_LINE}.`],
        instructions: [...instructions, "• You must not use a dictionary."],
      };
    case "business":
      return {
        materials: [
          "For this paper you must have:",
          PEN_LINE,
          "• a pencil and a ruler.",
          "You may use a calculator.",
        ],
        instructions,
      };
    case "combined-science":
    case "biology":
    case "chemistry":
    case "physics":
      return {
        materials: [
          "For this paper you must have:",
          PEN_LINE,
          "• a pencil, a rubber and a ruler",
          "• a protractor.",
          "You may use a calculator.",
        ],
        instructions,
      };
    case "geography":
    default:
      return {
        materials: [
          "For this paper you must have:",
          PEN_LINE,
          "• a pencil, a rubber and a ruler.",
          "You may use a calculator.",
        ],
        instructions,
      };
  }
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
