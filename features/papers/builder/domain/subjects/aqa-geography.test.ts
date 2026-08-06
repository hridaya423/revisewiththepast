import { describe, expect, it } from "vitest";
import type { QuestionBankPart } from "@/shared/domain/paper";
import { groupQuestionPartsIntoUnits, groupQuestionUnitsBySourceQuestion, selectQuestionUnits } from "./aqa-geography";

function part(overrides: Partial<QuestionBankPart>): QuestionBankPart {
  return {
    partKey: overrides.partKey ?? "part",
    unitKey: overrides.unitKey ?? "unit",
    taggedPaperId: "paper",
    sourceRelativePath: "edexcel/mathematics/paper.pdf",
    questionPaperCdnUrl: "https://example.test/paper.pdf",
    questionPaperFileName: "paper.pdf",
    pageAssetCdnUrls: [],
    boardCode: "edexcel",
    subjectSlug: "mathematics",
    paperCode: "paper-1",
    year: 2024,
    session: "june",
    questionId: overrides.questionId ?? overrides.partKey ?? "part",
    questionNumber: "4",
    questionPartNumber: "a",
    questionPath: ["a"],
    sectionCode: null,
    sectionName: null,
    marks: 1,
    sourceTotalMarks: null,
    marksValidated: "unknown",
    canonicalLeaf: "maths.algebra",
    promptText: "4 (a) Work out the answer.",
    contextText: null,
    pageNumber: 2,
    pageNumbers: [2],
    bbox: null,
    sourceMode: "crop_or_text",
    assetIds: [],
    ...overrides,
  };
}

describe("question unit validation", () => {
  it("uses a validated source total for a multipart source question", () => {
    const units = groupQuestionUnitsBySourceQuestion([
      { ...groupQuestionPartsIntoUnits([part({ partKey: "a", marks: 3, questionPartNumber: "a", questionPath: ["a"], sourceTotalMarks: 5, marksValidated: "validated" })])[0] },
      { ...groupQuestionPartsIntoUnits([part({ partKey: "b", marks: 2, questionPartNumber: "b", questionPath: ["b"], sourceTotalMarks: 5, marksValidated: "validated" })])[0] },
    ]);
    expect(units).toHaveLength(1);
    expect(units[0]?.totalMarks).toBe(5);
    expect(units[0]?.marksValidated).toBe("validated");
    expect(units[0]?.parts.map((item) => item.questionPath)).toEqual([["a"], ["b"]]);
  });

  it("does not make a mismatched source question selectable", () => {
    const units = groupQuestionPartsIntoUnits([
      part({ sourceTotalMarks: 5, marks: 3, marksValidated: "mismatch" }),
    ]);
    expect(units).toEqual([]);
  });

  it("does not merge equal question numbers from different source PDFs", () => {
    const units = groupQuestionUnitsBySourceQuestion([
      { ...groupQuestionPartsIntoUnits([part({ sourceRelativePath: "edexcel/mathematics/a.pdf" })])[0] },
      { ...groupQuestionPartsIntoUnits([part({ sourceRelativePath: "edexcel/mathematics/b.pdf" })])[0] },
    ]);

    expect(units).toHaveLength(2);
    expect(new Set(units.map((unit) => unit.sourceRelativePath))).toEqual(new Set([
      "edexcel/mathematics/a.pdf",
      "edexcel/mathematics/b.pdf",
    ]));
  });

  it("does not select Maths units whose source total was not validated", () => {
    const [unit] = groupQuestionUnitsBySourceQuestion([
      { ...groupQuestionPartsIntoUnits([part({ sourceTotalMarks: null, marksValidated: "unknown" })])[0] },
    ]);

    expect(selectQuestionUnits({
      units: unit ? [unit] : [],
      selectedLeafTopicIds: ["maths.algebra"],
      targetMarks: 1,
      maxQuestions: 1,
      rng: () => 0,
    }).selectedUnits).toEqual([]);
  });
});
