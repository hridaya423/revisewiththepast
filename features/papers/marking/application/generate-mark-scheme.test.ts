import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assembleMarkSchemePdf: vi.fn(),
  getMarkableUnitsByUnitKeys: vi.fn(),
  getPaperMakerSubject: vi.fn(),
}));

vi.mock("../infrastructure/mark-scheme/mark-scheme", () => ({
  assembleMarkSchemePdf: mocks.assembleMarkSchemePdf,
}));
vi.mock("@/features/papers/infrastructure/paper-maker", () => ({
  getMarkableUnitsByUnitKeys: mocks.getMarkableUnitsByUnitKeys,
}));
vi.mock("@/shared/domain/subject-catalog", () => ({
  getPaperMakerSubject: mocks.getPaperMakerSubject,
}));

import { generateMarkScheme } from "./generate-mark-scheme";

describe("generateMarkScheme", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPaperMakerSubject.mockReturnValue({ coverTitle: "Geography" });
    mocks.getMarkableUnitsByUnitKeys.mockResolvedValue([{ unitKey: "unit-1" }]);
  });

  it("preserves assembly diagnostics for non-MCP callers", async () => {
    mocks.assembleMarkSchemePdf.mockResolvedValue({
      bytes: new Uint8Array(),
      includedCount: 0,
      failures: [{ unitKey: "unit-1", label: "Q1", error: "No source page" }],
    });

    await expect(generateMarkScheme({
      subjectKey: "aqa-geography",
      selectedUnitKeys: ["unit-1"],
    })).rejects.toThrow("No mark scheme pages could be assembled. No source page");
  });

  it("rejects a partial mark scheme instead of returning placeholders", async () => {
    mocks.getMarkableUnitsByUnitKeys.mockResolvedValue([
      { unitKey: "unit-1" },
      { unitKey: "unit-2" },
    ]);
    mocks.assembleMarkSchemePdf.mockResolvedValue({
      bytes: new Uint8Array([1]),
      includedCount: 1,
      failures: [{ unitKey: "unit-2", label: "Q2", error: "Wrong source question" }],
    });

    await expect(generateMarkScheme({
      subjectKey: "aqa-geography",
      selectedUnitKeys: ["unit-1", "unit-2"],
    })).rejects.toThrow("Could not assemble every selected question");
  });
});
