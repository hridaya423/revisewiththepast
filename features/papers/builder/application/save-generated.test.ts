import { beforeEach, describe, expect, it, vi } from "vitest";

import type { QuestionUnit } from "@/shared/domain/paper";

const mocks = vi.hoisted(() => ({
  createSavedPaper: vi.fn(),
  getSavedPaperByImportKey: vi.fn(),
  claimGenerationReceipt: vi.fn(),
  getMarkableUnitsByUnitKeys: vi.fn(),
  getPaperMakerSubject: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("../infrastructure/convex/saved-papers", () => ({
  createSavedPaper: mocks.createSavedPaper,
  getSavedPaperByImportKey: mocks.getSavedPaperByImportKey,
}));
vi.mock("../infrastructure/convex/generation-receipts", () => ({
  claimGenerationReceipt: mocks.claimGenerationReceipt,
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

function generatedPdfFile() {
  return new File(["%PDF-1.7 fake body"], "paper.pdf", { type: "application/pdf" });
}

describe("save generated paper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claimGenerationReceipt.mockResolvedValue({
      subjectKey: "aqa-geography",
      subjectTier: undefined,
      selectedUnitKeys: ["unit_1", "unit_2"],
      targetMarks: 8,
      totalMarks: 8,
      timeMinutes: 10,
      questionCount: 2,
    });
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
    mocks.claimGenerationReceipt.mockResolvedValue({
      subjectKey: "aqa-geography",
      subjectTier: undefined,
      selectedUnitKeys: ["unit_1"],
      targetMarks: 10,
      totalMarks: 10,
      timeMinutes: 15,
      questionCount: 1,
    });
    mocks.getSavedPaperByImportKey.mockResolvedValue({ _id: "paper_1", pdfUrl: "https://cdn.example/paper.pdf" });

    const result = await saveGeneratedPaper({
      generationReceiptId: "receipt_1",
      file: generatedPdfFile(),
    });

    expect(result).toEqual({ savedPaperId: "paper_1", pdfUrl: "https://cdn.example/paper.pdf" });
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.createSavedPaper).not.toHaveBeenCalled();
  });

  it("rejects files above the size cap before touching storage", async () => {
    const oversized = new File([new Uint8Array(41 * 1024 * 1024)], "paper.pdf", { type: "application/pdf" });

    await expect(saveGeneratedPaper({ generationReceiptId: "receipt_1", file: oversized })).rejects.toThrowError("limited to 40 MB");
    expect(mocks.claimGenerationReceipt).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("rejects a non-PDF file renamed to .pdf before claiming the receipt", async () => {
    const fake = new File(["this is definitely not a pdf"], "paper.pdf", { type: "application/pdf" });

    await expect(saveGeneratedPaper({ generationReceiptId: "receipt_1", file: fake })).rejects.toThrowError("not a valid PDF");
    expect(mocks.claimGenerationReceipt).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("rejects a file that does not match the generation receipt hash", async () => {
    mocks.claimGenerationReceipt.mockRejectedValue(new Error("This file was not produced by paper generation."));

    await expect(saveGeneratedPaper({ generationReceiptId: "receipt_1", file: generatedPdfFile() })).rejects.toThrowError("not produced by paper generation");
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.createSavedPaper).not.toHaveBeenCalled();
  });

  it("derives totalMarks from resolved units, not from the receipt or client", async () => {
    mocks.claimGenerationReceipt.mockResolvedValue({
      subjectKey: "aqa-geography",
      subjectTier: undefined,
      selectedUnitKeys: ["unit_1", "unit_2"],
      targetMarks: 999,
      totalMarks: 999,
      timeMinutes: 15,
      questionCount: 2,
    });
    mocks.getSavedPaperByImportKey.mockResolvedValue(null);
    mocks.getMarkableUnitsByUnitKeys.mockResolvedValue([
      questionUnit("unit_1", "9"),
      questionUnit("unit_2", "3"),
    ]);
    mocks.upload.mockResolvedValue({ id: "upload_1", url: "https://cdn.example/paper.pdf", size: 3, contentType: "application/pdf", createdAt: 0 });
    mocks.createSavedPaper.mockResolvedValue("paper_1");

    await saveGeneratedPaper({ generationReceiptId: "receipt_1", file: generatedPdfFile() });

    expect(mocks.createSavedPaper).toHaveBeenCalledWith(expect.objectContaining({ totalMarks: 8 }));
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
      generationReceiptId: "receipt_1",
      file: generatedPdfFile(),
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
