import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("save generated paper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPaperMakerSubject.mockReturnValue({ paperOptions: [] });
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
});
