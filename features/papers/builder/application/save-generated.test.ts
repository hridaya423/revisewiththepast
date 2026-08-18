import { beforeEach, describe, expect, it, vi } from "vitest";

import type { QuestionUnit } from "@/shared/domain/paper";

const mocks = vi.hoisted(() => ({
  createSavedPaper: vi.fn(),
  getSavedPaperByImportKey: vi.fn(),
  getMarkableUnitsByUnitKeys: vi.fn(),
  getPaperMakerSubject: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("../infrastructure/convex/saved-papers", () => ({
  createSavedPaper: mocks.createSavedPaper,
  getSavedPaperByImportKey: mocks.getSavedPaperByImportKey,
}));
vi.mock("@/features/papers/infrastructure/paper-maker", () => ({
  getMarkableUnitsByUnitKeys: mocks.getMarkableUnitsByUnitKeys,
}));
vi.mock("../domain/subjects", () => ({ getPaperMakerSubject: mocks.getPaperMakerSubject }));
vi.mock("@/shared/infrastructure/cdn/hackclub", () => ({ uploadToHackClubCdn: mocks.upload }));

import { saveGeneratedPaper } from "./save-generated";

function questionUnit(unitKey: string, questionNumber: string): QuestionUnit {
  const part = {
    partKey: `${unitKey}-part`,
    unitKey,
    taggedPaperId: "paper",
    sourceRelativePath: `source/${unitKey}.pdf`,
    questionPaperCdnUrl: null,
    questionPaperFileName: `${unitKey}.pdf`,
    pageAssetCdnUrls: [],
    boardCode: "aqa",
    subjectSlug: "geography",
    paperCode: "paper-1",
    year: 2024,
    session: "june",
    questionId: `${unitKey}-question`,
    questionNumber,
    questionPartNumber: null,
    sectionCode: null,
    sectionName: null,
    marks: 4,
    canonicalLeaf: "",
    promptText: `Source question ${questionNumber}`,
    contextText: null,
    pageNumber: 2,
    pageNumbers: [2],
    bbox: null,
    sourceMode: "crop_or_text",
    assetIds: [],
  };

  return {
    unitKey,
    groupUnitKey: unitKey,
    sourceQuestionKey: `source-question-${questionNumber}`,
    sourceRelativePath: part.sourceRelativePath,
    questionPaperCdnUrl: null,
    questionPaperFileName: part.questionPaperFileName,
    boardCode: part.boardCode,
    subjectSlug: part.subjectSlug,
    paperCode: part.paperCode,
    year: part.year,
    session: part.session,
    questionNumber,
    sectionCode: null,
    sectionName: null,
    totalMarks: 4,
    canonicalLeafs: [],
    parts: [part],
    pages: [{ pageNumber: 2, parts: [part], bboxUnion: null }],
  };
}

describe("save generated paper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPaperMakerSubject.mockReturnValue({
      key: "aqa-geography",
      label: "AQA Geography",
      boardLabel: "AQA",
      boardCode: "aqa",
      subjectSlug: "geography",
      coverTitle: "Geography",
      codeLabel: "8035",
      description: "",
      topicSelectionEnabled: true,
      generationEnabled: true,
      availabilityNote: "",
      recommendedMinutesPerMark: 1,
      paperOptions: [],
      defaultPaperCodes: [],
      tiers: [],
    });
    mocks.getMarkableUnitsByUnitKeys.mockResolvedValue([{ unitKey: "unit_1" }]);
  });

  it("returns the existing paper without uploading the same generated PDF again", async () => {
    mocks.getSavedPaperByImportKey.mockResolvedValue({ _id: "paper_1", pdfUrl: "https://cdn.example/paper.pdf" });

    const result = await saveGeneratedPaper({
      subjectKey: "aqa-geography",
      targetMarks: 10,
      totalMarks: 10,
      timeMinutes: 15,
      selectedUnitKeys: ["unit_1"],
      file: new File(["pdf"], "paper.pdf", { type: "application/pdf" }),
    });

    expect(result).toEqual({ savedPaperId: "paper_1", pdfUrl: "https://cdn.example/paper.pdf" });
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.createSavedPaper).not.toHaveBeenCalled();
  });

  it("keeps generated display order separate from source question identity", async () => {
    mocks.getSavedPaperByImportKey.mockResolvedValue(null);
    mocks.getMarkableUnitsByUnitKeys.mockResolvedValue([
      questionUnit("unit_1", "9"),
      questionUnit("unit_2", "3"),
    ]);
    mocks.upload.mockResolvedValue({
      id: "upload_1",
      url: "https://cdn.example/paper.pdf",
      size: 3,
      contentType: "application/pdf",
      createdAt: 0,
    });
    mocks.createSavedPaper.mockResolvedValue("paper_1");

    await saveGeneratedPaper({
      subjectKey: "aqa-geography",
      targetMarks: 8,
      totalMarks: 8,
      timeMinutes: 10,
      selectedUnitKeys: ["unit_1", "unit_2"],
      file: new File(["pdf"], "paper.pdf", { type: "application/pdf" }),
    });

    expect(mocks.createSavedPaper).toHaveBeenCalledWith(expect.objectContaining({
      questions: [
        expect.objectContaining({
          displayOrder: 1,
          unitKey: "unit_1",
          sourceQuestionKey: "source-question-9",
          questionNumber: "9",
        }),
        expect.objectContaining({
          displayOrder: 2,
          unitKey: "unit_2",
          sourceQuestionKey: "source-question-3",
          questionNumber: "3",
        }),
      ],
    }));
  });
});
