import type { PaperMakerSubjectDefinition, PaperOption } from "@/shared/domain/subject";

export { PAPER_MAKER_SUBJECTS } from "@/shared/domain/subject-catalog";
export { getPaperMakerSubject } from "@/shared/domain/subject-catalog";
export type { PaperBuildTargetMode, PaperMakerSubjectDefinition, PaperOption, SubjectTierKey } from "@/shared/domain/subject";
export type { PaperMakerSubjectKey } from "@/shared/domain/paper";

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
