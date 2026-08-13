import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listGenerationSubjects: vi.fn(),
  formatSubjectsForTool: vi.fn(),
  getGenerationSubjectCatalog: vi.fn(),
  formatSubjectCatalogForTool: vi.fn(),
  generatePaperBundle: vi.fn(),
  paperBundleContent: vi.fn(),
}));

vi.mock("./paper-bundle", () => mocks);

import { createPaperMakerMcpServer } from "./server";

const subjects = {
  nextTool: "get_subject_catalog" as const,
  subjects: [{
    key: "aqa-geography",
    label: "Geography",
    board: "AQA",
    code: "8035",
    tiers: [],
    paperOptions: [{ code: "paper-1", label: "Paper 1" }],
    defaultPaperCodes: ["paper-1"],
  }],
};

const catalog = {
  nextTool: "generate_paper_bundle" as const,
  key: "aqa-geography",
  label: "Geography",
  board: "AQA",
  code: "8035",
  description: "Geography",
  availabilityNote: "Available",
  taggedQuestionUnits: 1,
  benchmarkMinutesPerMark: 1,
  paperOptions: [{ code: "paper-1", label: "Paper 1" }],
  defaultPaperCodes: ["paper-1"],
  tiers: [],
  topics: [{ id: "natural-hazards", label: "Natural hazards", questionUnitCount: 1 }],
  generation: {
    subjectKey: "aqa-geography",
    defaultPaperCodes: ["paper-1"],
    requiresExplicitSelectAll: true as const,
  },
  detailLoaded: true as const,
};

const bundle = {
  bundleId: "bundle_test",
  subjectKey: "aqa-geography",
  totalMarks: 1,
  timeMinutes: 1,
  questionCount: 1,
  coveredTopicIds: ["natural-hazards"],
  paper: { fileName: "paper.pdf", url: "https://files.example/paper.pdf", size: 100, mimeType: "application/pdf" as const },
  markScheme: { fileName: "mark-scheme.pdf", url: "https://files.example/mark-scheme.pdf", size: 100, mimeType: "application/pdf" as const },
  warnings: [],
  expiresAt: "2026-08-09T00:00:00.000Z",
};

describe("MCP Streamable HTTP integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listGenerationSubjects.mockResolvedValue(subjects);
    mocks.formatSubjectsForTool.mockReturnValue("Next tool: get_subject_catalog.");
    mocks.getGenerationSubjectCatalog.mockResolvedValue(catalog);
    mocks.formatSubjectCatalogForTool.mockReturnValue("Next tool: generate_paper_bundle.");
    mocks.generatePaperBundle.mockResolvedValue(bundle);
    mocks.paperBundleContent.mockReturnValue([
      { type: "text", text: "Generated paper." },
      { type: "resource", resource: { uri: bundle.paper.url, blob: "JVBERg==", mimeType: "application/pdf" } },
      { type: "resource", resource: { uri: bundle.markScheme.url, blob: "JVBERg==", mimeType: "application/pdf" } },
    ]);
  });

  it("connects through the real fetch handler and calls every public tool", async () => {
    const handler = createMcpHandler(() => createPaperMakerMcpServer(), {
      responseMode: "sse",
      keepAliveMs: 100,
    });
    const transport = new StreamableHTTPClientTransport(new URL("http://example.test/mcp"), {
      fetch: (url, init) => handler.fetch(new Request(url, init)),
    });
    const client = new Client(
      { name: "gcsemeta-http-test", version: "1.0.0" },
      { versionNegotiation: { mode: "auto" } },
    );

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
        "generate_paper_bundle",
        "get_subject_catalog",
        "list_subjects",
      ]);

      const subjectResult = await client.callTool({ name: "list_subjects", arguments: {} });
      expect(subjectResult.isError).not.toBe(true);
      expect(subjectResult.structuredContent).toEqual(subjects);

      const catalogResult = await client.callTool({
        name: "get_subject_catalog",
        arguments: { subjectKey: "aqa-geography" },
      });
      expect(catalogResult.isError).not.toBe(true);
      expect(catalogResult.structuredContent).toEqual(catalog);

      const bundleResult = await client.callTool({
        name: "generate_paper_bundle",
        arguments: {
          subjectKey: "aqa-geography",
          topicIds: ["natural-hazards"],
          targetMarks: 1,
          maxQuestions: 1,
        },
      });
      expect(bundleResult.isError).not.toBe(true);
      expect(bundleResult.structuredContent).toEqual(bundle);
      expect(bundleResult.content.filter((item) => item.type === "resource")).toHaveLength(2);
      expect(mocks.generatePaperBundle).toHaveBeenCalledWith(
        expect.objectContaining({ subjectKey: "aqa-geography" }),
        expect.any(Request),
      );
    } finally {
      await client.close();
      await handler.close();
    }
  });

  it("returns a safe tool execution error instead of a protocol failure", async () => {
    mocks.getGenerationSubjectCatalog.mockRejectedValueOnce(new Error("/private/source/path.pdf"));
    const handler = createMcpHandler(() => createPaperMakerMcpServer(), { responseMode: "sse" });
    const transport = new StreamableHTTPClientTransport(new URL("http://example.test/mcp"), {
      fetch: (url, init) => handler.fetch(new Request(url, init)),
    });
    const client = new Client({ name: "gcsemeta-error-test", version: "1.0.0" });

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "get_subject_catalog",
        arguments: { subjectKey: "aqa-geography" },
      });
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([{ type: "text", text: "Could not load the subject catalog." }]);
      expect(JSON.stringify(result.content)).not.toContain("private/source");
    } finally {
      await client.close();
      await handler.close();
    }
  });
});
