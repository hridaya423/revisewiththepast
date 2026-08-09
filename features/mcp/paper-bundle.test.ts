import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/shared/application/errors";

const mocks = vi.hoisted(() => ({
  generateMarkScheme: vi.fn(),
  generatePaper: vi.fn(),
  getSubjectDetail: vi.fn(),
  parseGeneratePaperRequest: vi.fn(),
  reservePaperGeneration: vi.fn(),
  getArtifactExpiry: vi.fn(),
  uploadMcpArtifact: vi.fn(),
}));

vi.mock("@/features/papers/server", () => ({
  generateMarkScheme: mocks.generateMarkScheme,
  generatePaper: mocks.generatePaper,
  getSubjectDetail: mocks.getSubjectDetail,
  parseGeneratePaperRequest: mocks.parseGeneratePaperRequest,
}));
vi.mock("./rate-limit", () => ({ reservePaperGeneration: mocks.reservePaperGeneration }));
vi.mock("./artifacts", () => ({
  getArtifactExpiry: mocks.getArtifactExpiry,
  uploadMcpArtifact: mocks.uploadMcpArtifact,
}));

import {
  formatSubjectCatalogForTool,
  formatSubjectsForTool,
  generatePaperBundle,
  getGenerationSubjectCatalog,
  listGenerationSubjects,
  normalizePaperBundleInput,
  paperBundleContent,
} from "./paper-bundle";

const baseInput = {
  subjectKey: "aqa-geography" as const,
  topicIds: [],
  paperCodes: [],
  targetMarks: 40,
  targetMode: "marks" as const,
  questionMix: "balanced" as const,
  maxQuestions: undefined,
  seed: undefined,
  timeMinutes: undefined,
  selectAllTopics: undefined,
};

describe("MCP paper bundle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.parseGeneratePaperRequest.mockImplementation((input) => ({ success: true, data: input }));
    mocks.reservePaperGeneration.mockResolvedValue({ allowed: true, retryAt: Date.now(), remainingForCaller: 9, remainingGlobal: 299 });
    mocks.getArtifactExpiry.mockReturnValue(1_800_000_000_000);
    mocks.getSubjectDetail.mockResolvedValue({
      key: "aqa-geography",
      taggedQuestionUnits: 2,
      benchmarkMinutesPerMark: 1,
      topics: [{ id: "physical", label: "Physical", leafTopicIds: ["physical"], questionUnitCount: 2 }],
      tiers: [],
      detailLoaded: true,
    });
  });

  it("requires an explicit broad-selection choice and uses configured paper defaults", async () => {
    await expect(normalizePaperBundleInput(baseInput)).rejects.toThrow("selectAllTopics");

    const result = await normalizePaperBundleInput({ ...baseInput, selectAllTopics: true });

    expect(result.request.selectAllTopics).toBe(true);
    expect(result.request.paperCodes).toEqual(["paper-1", "paper-2", "paper-3"]);
    expect(mocks.getSubjectDetail).not.toHaveBeenCalled();
  });

  it("rejects an invalid paper code before consuming generation capacity", async () => {
    await expect(normalizePaperBundleInput({ ...baseInput, paperCodes: ["paper-9"] })).rejects.toThrow("Unknown paper code");
    expect(mocks.reservePaperGeneration).not.toHaveBeenCalled();
  });

  it("returns a compact catalog with an explicit next tool", async () => {
    const result = await getGenerationSubjectCatalog("aqa-geography");

    expect(result.nextTool).toBe("generate_paper_bundle");
    expect(result.generation.defaultPaperCodes).toEqual(["paper-1", "paper-2", "paper-3"]);
    expect(result.topics[0]).toEqual({ id: "physical", label: "Physical", questionUnitCount: 2 });
    expect(result.topics[0]).not.toHaveProperty("leafTopicIds");
  });

  it("requires a tier before loading a tiered catalog", async () => {
    await expect(getGenerationSubjectCatalog("edexcel-combined-science")).rejects.toThrow("Select Foundation or Higher");
    expect(mocks.getSubjectDetail).not.toHaveBeenCalled();
  });

  it("keeps discovery text directional instead of duplicating structured payloads", async () => {
    const subjects = await listGenerationSubjects();
    const catalog = await getGenerationSubjectCatalog("aqa-geography");

    expect(formatSubjectsForTool(subjects)).toContain("Next tool: get_subject_catalog");
    expect(formatSubjectCatalogForTool(catalog)).toContain("Next tool: generate_paper_bundle");
    expect(formatSubjectCatalogForTool(catalog)).not.toContain("leafTopicIds");
  });

  it("returns the paper when mark-scheme generation fails without leaking internals", async () => {
    mocks.generatePaper.mockResolvedValue({
      pdfBytes: new Uint8Array([37, 80, 68, 70, 45]),
      fileName: "paper.pdf",
      selection: { selectedUnits: [{ unitKey: "unit-1" }], totalMarks: 40, coveredLeafTopicIds: ["physical"] },
      timeMinutes: 40,
    });
    mocks.generateMarkScheme.mockRejectedValue(new DomainError("No mark scheme pages could be assembled. /private/source/path.pdf"));
    mocks.uploadMcpArtifact.mockResolvedValue({ fileName: "paper.pdf", url: "https://cdn.example/paper.pdf", size: 4, mimeType: "application/pdf" });

    const result = await generatePaperBundle({ ...baseInput, selectAllTopics: true });

    expect(result.markScheme).toBeNull();
    expect(result.paper.url).toBe("https://cdn.example/paper.pdf");
    expect(result.warnings).toEqual(["Mark scheme generation was unavailable."]);
    expect(result.warnings.join(" ")).not.toContain("internal source path");
    expect(mocks.reservePaperGeneration).toHaveBeenCalledOnce();
  });

  it("publishes partial mark-scheme warnings alongside both artifacts", async () => {
    mocks.generatePaper.mockResolvedValue({
      pdfBytes: new Uint8Array([37, 80, 68, 70]),
      fileName: "paper.pdf",
      selection: { selectedUnits: [{ unitKey: "unit-1" }], totalMarks: 40, coveredLeafTopicIds: ["physical"] },
      timeMinutes: 40,
    });
    mocks.generateMarkScheme.mockResolvedValue({
      bytes: new Uint8Array([37, 80, 68, 70, 45]),
      fileName: "mark-scheme.pdf",
      failures: [{ label: "Q1", error: "No source page" }],
    });
    mocks.uploadMcpArtifact
      .mockResolvedValueOnce({ fileName: "paper.pdf", url: "https://cdn.example/paper.pdf", size: 4, mimeType: "application/pdf" })
      .mockResolvedValueOnce({ fileName: "mark-scheme.pdf", url: "https://cdn.example/ms.pdf", size: 4, mimeType: "application/pdf" });

    const result = await generatePaperBundle({ ...baseInput, selectAllTopics: true });

    expect(result.markScheme?.url).toBe("https://cdn.example/ms.pdf");
    expect(result.warnings).toEqual(["Q1: Mark-scheme source could not be assembled."]);
    expect(mocks.uploadMcpArtifact).toHaveBeenCalledTimes(2);
  });

  it("uploads the paper before attempting mark-scheme assembly", async () => {
    mocks.generatePaper.mockResolvedValue({
      pdfBytes: new Uint8Array([37, 80, 68, 70, 45]),
      fileName: "paper.pdf",
      selection: { selectedUnits: [{ unitKey: "unit-1" }], totalMarks: 40, coveredLeafTopicIds: ["physical"] },
      timeMinutes: 40,
    });
    mocks.uploadMcpArtifact.mockRejectedValueOnce(new Error("paper upload failed"));

    await expect(generatePaperBundle({ ...baseInput, selectAllTopics: true })).rejects.toThrow("paper upload failed");
    expect(mocks.generateMarkScheme).not.toHaveBeenCalled();
  });

  it("returns compact human content alongside machine-readable artifact links", () => {
    const content = paperBundleContent({
      bundleId: "bundle_1",
      subjectKey: "aqa-geography",
      totalMarks: 40,
      timeMinutes: 40,
      questionCount: 4,
      coveredTopicIds: ["physical"],
      paper: { fileName: "paper.pdf", url: "https://cdn.example/paper.pdf", size: 4, mimeType: "application/pdf" },
      markScheme: { fileName: "mark-scheme.pdf", url: "https://cdn.example/ms.pdf", size: 4, mimeType: "application/pdf" },
      warnings: [],
      expiresAt: new Date(1_800_000_000_000).toISOString(),
    });

    expect(content).toHaveLength(3);
    expect(content[0]).toMatchObject({ type: "text" });
    expect((content[0] as { text: string }).text).not.toContain('"bundleId"');
    expect(content.slice(1).every((item) => item.type === "resource_link")).toBe(true);
  });
});
