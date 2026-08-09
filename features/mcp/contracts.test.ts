import { describe, expect, it } from "vitest";

import { generatePaperBundleInputSchema } from "./contracts";

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
});
