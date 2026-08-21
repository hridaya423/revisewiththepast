import { describe, expect, it } from "vitest";
import type { QuestionBankPart } from "@/shared/domain/paper";
import { groupQuestionPartsIntoUnits, groupQuestionUnitsBySourceQuestion, selectQuestionUnits, sortQuestionUnitsForRendering } from "./aqa-geography";

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

  it("does not read Edexcel decimal values as AQA question numbers", () => {
    const units = groupQuestionPartsIntoUnits([
      part({
        boardCode: "edexcel",
        questionNumber: "6",
        promptText: "The mass increased from 0.1 g to 0.3 g.",
      }),
    ]);

    expect(units).toHaveLength(1);
  });

  it("drops a grouped source question when selectable parts do not reach its source total", () => {
    const units = groupQuestionUnitsBySourceQuestion([
      { ...groupQuestionPartsIntoUnits([part({ partKey: "b", marks: 2, questionPartNumber: "b", questionPath: ["b"], sourceTotalMarks: 4, marksValidated: "validated" })])[0] },
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

describe("question unit rendering order", () => {
  it("orders French questions by marks before source position", () => {
    const units = groupQuestionPartsIntoUnits([
      part({
        partKey: "later-source-lower-marks",
        unitKey: "later-source-lower-marks",
        sourceRelativePath: "edexcel/french/higher/2024.pdf",
        subjectSlug: "french",
        questionNumber: "2",
        pageNumber: 3,
        pageNumbers: [3],
        marks: 3,
      }),
      part({
        partKey: "earlier-source-later-page",
        unitKey: "earlier-source-later-page",
        sourceRelativePath: "edexcel/french/higher/2023.pdf",
        subjectSlug: "french",
        questionNumber: "8",
        pageNumber: 14,
        pageNumbers: [14],
        marks: 4,
      }),
      part({
        partKey: "earlier-source-earlier-page",
        unitKey: "earlier-source-earlier-page",
        sourceRelativePath: "edexcel/french/higher/2023.pdf",
        subjectSlug: "french",
        questionNumber: "5",
        pageNumber: 9,
        pageNumbers: [9],
        marks: 4,
      }),
    ]);

    sortQuestionUnitsForRendering(units);

    expect(units.map((unit) => unit.unitKey)).toEqual([
      "later-source-lower-marks",
      "earlier-source-earlier-page",
      "earlier-source-later-page",
    ]);
  });
});
