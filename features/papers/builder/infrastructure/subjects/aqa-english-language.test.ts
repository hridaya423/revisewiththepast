import { describe, expect, it } from "vitest";

import { getPaperMakerSubject } from "@/shared/domain/subject-catalog";
import type { QuestionBankPart, QuestionUnit } from "@/shared/domain/paper";
import { buildGeneratedCoverModel } from "../pdf/cover";
import { groupAqaEnglishLanguageSectionUnits } from "./aqa-english-language";

function sectionAUnit(questionNumber: string, marks: number, pageNumber: number): QuestionUnit {
  const part: QuestionBankPart = {
    partKey: `q${questionNumber}`,
    unitKey: `q${questionNumber}`,
    taggedPaperId: "paper",
    sourceRelativePath: "aqa/english-language/paper.pdf",
    questionPaperCdnUrl: "https://example.test/paper.pdf",
    questionPaperFileName: "paper.pdf",
    pageAssetCdnUrls: [],
    boardCode: "aqa",
    subjectSlug: "english-language",
    paperCode: "paper-2",
    year: 2024,
    session: "june",
    questionId: `q${questionNumber}`,
    questionNumber,
    questionPartNumber: null,
    sectionCode: "A",
    sectionName: "Reading",
    marks,
    canonicalLeaf: `english.reading.q${questionNumber}`,
    promptText: `${questionNumber} Read the source and answer the question.`,
    contextText: null,
    pageNumber,
    pageNumbers: [pageNumber],
    bbox: { x0: 40, y0: 100, x1: 550, y1: 700 },
    sourceMode: "crop_or_text",
    assetIds: [],
  };

  return {
    unitKey: part.partKey,
    groupUnitKey: part.unitKey,
    sourceQuestionKey: `original-q${questionNumber}`,
    sourceRelativePath: part.sourceRelativePath,
    questionPaperCdnUrl: part.questionPaperCdnUrl,
    questionPaperFileName: part.questionPaperFileName,
    boardCode: part.boardCode,
    subjectSlug: part.subjectSlug,
    paperCode: part.paperCode,
    year: part.year,
    session: part.session,
    questionNumber,
    sectionCode: part.sectionCode,
    sectionName: part.sectionName,
    totalMarks: marks,
    canonicalLeafs: [part.canonicalLeaf],
    parts: [part],
    pages: [{ pageNumber, parts: [part], bboxUnion: part.bbox }],
  };
}

describe("AQA English Language grouping", () => {
  it("keeps a source paper's Section A questions in one atomic unit", () => {
    const grouped = groupAqaEnglishLanguageSectionUnits([
      sectionAUnit("1", 4, 2),
      sectionAUnit("2", 8, 3),
      sectionAUnit("3", 12, 6),
      sectionAUnit("4", 16, 9),
    ]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.totalMarks).toBe(40);
    expect(new Set(grouped[0]?.parts.map((part) => part.questionNumber))).toEqual(new Set(["1", "2", "3", "4"]));
  });

  it("counts the four questions inside an atomic Section A unit on the cover", () => {
    const subject = getPaperMakerSubject("aqa-english-language");
    if (!subject) throw new Error("Missing AQA English Language subject definition");
    const selectedUnits = groupAqaEnglishLanguageSectionUnits([
      sectionAUnit("1", 4, 2),
      sectionAUnit("2", 8, 3),
      sectionAUnit("3", 12, 6),
      sectionAUnit("4", 16, 9),
    ]);

    const cover = buildGeneratedCoverModel({
      subject,
      tierLabel: null,
      selectedUnits,
      selectedPapers: subject.paperOptions,
      timeMinutes: 60,
      examContext: { materials: [], instructions: [] },
    });

    expect(cover.questionCount).toBe(4);
  });
});
