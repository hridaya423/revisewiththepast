import { describe, expect, it } from "vitest";

import { artifactOutputSchema, generatePaperBundleInputSchema, paperBundleOutputSchema } from "./contracts";

describe("MCP paper contracts", () => {
  it("defaults an omitted paper request to a 40-mark balanced paper", () => {
    const result = generatePaperBundleInputSchema.parse({ subjectKey: "aqa-geography" });

    expect(result.targetMarks).toBe(40);
    expect(result.questionMix).toBe("balanced");
    expect(result.topicIds).toEqual([]);
    expect(result.paperCodes).toEqual([]);
    expect(result.selectAllTopics).toBeUndefined();
  });

  it("rejects values outside the public generation bounds", () => {
    expect(() => generatePaperBundleInputSchema.parse({ subjectKey: "aqa-geography", targetMarks: 201 })).toThrow();
    expect(() => generatePaperBundleInputSchema.parse({ subjectKey: "aqa-geography", maxQuestions: 41 })).toThrow();
    expect(() => generatePaperBundleInputSchema.parse({ subjectKey: "aqa-geography", timeMinutes: 14 })).toThrow();
  });

  it("keeps the public request free of internal continuation fields", () => {
    const result = generatePaperBundleInputSchema.parse({
      subjectKey: "aqa-geography",
      priorPaperCount: 1,
      excludeSourceQuestionKeys: ["secret"],
    });

    expect(result).not.toHaveProperty("priorPaperCount");
    expect(result).not.toHaveProperty("excludeSourceQuestionKeys");
  });

  it("accepts valid artifact URLs and bundle datetimes", () => {
    expect(artifactOutputSchema.parse({
      fileName: "paper.pdf",
      url: "https://cdn.example.com/paper.pdf",
      size: 1024,
      mimeType: "application/pdf",
    }).url).toBe("https://cdn.example.com/paper.pdf");

    expect(paperBundleOutputSchema.parse({
      bundleId: "bundle_123",
      subjectKey: "aqa-geography",
      totalMarks: 40,
      timeMinutes: 45,
      questionCount: 10,
      coveredTopicIds: [],
      paper: { fileName: "paper.pdf", url: "https://cdn.example.com/paper.pdf", size: 1024, mimeType: "application/pdf" },
      markScheme: null,
      warnings: [],
      expiresAt: "2026-08-13T17:49:25.000Z",
    }).expiresAt).toBe("2026-08-13T17:49:25.000Z");
  });

  it("rejects malformed artifact URLs and bundle datetimes", () => {
    expect(() => artifactOutputSchema.parse({
      fileName: "paper.pdf",
      url: "not-a-url",
      size: 1024,
      mimeType: "application/pdf",
    })).toThrow();

    expect(() => paperBundleOutputSchema.parse({
      bundleId: "bundle_123",
      subjectKey: "aqa-geography",
      totalMarks: 40,
      timeMinutes: 45,
      questionCount: 10,
      coveredTopicIds: [],
      paper: { fileName: "paper.pdf", url: "https://cdn.example.com/paper.pdf", size: 1024, mimeType: "application/pdf" },
      markScheme: null,
      warnings: [],
      expiresAt: "not-a-datetime",
    })).toThrow();
  });
});
