import { describe, expect, it } from "vitest";
import { parseGeneratePaperRequest } from "./generate-paper";

describe("generate paper contract", () => {
  it("applies safe defaults at the HTTP boundary", () => {
    const result = parseGeneratePaperRequest({});
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.subjectKey).toBe("aqa-geography");
    expect(result.data.targetMarks).toBe(40);
    expect(result.data.questionMix).toBe("balanced");
  });

  it("clamps bounded numeric inputs", () => {
    const result = parseGeneratePaperRequest({ targetMarks: 999, timeMinutes: 1, maxQuestions: 999 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.targetMarks).toBe(200);
    expect(result.data.timeMinutes).toBe(15);
    expect(result.data.maxQuestions).toBe(40);
  });

  it("rejects malformed collections", () => {
    const result = parseGeneratePaperRequest({ selectedTopicNodeIds: [1] });
    expect(result.success).toBe(false);
  });
});
