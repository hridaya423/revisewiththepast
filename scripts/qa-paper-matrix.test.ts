import { describe, expect, it } from "vitest";

import { buildQaPaperMatrix } from "./qa-paper-matrix";

describe("QA paper matrix", () => {
  it("covers every enabled subject, tier, and paper-code combination", () => {
    const matrix = buildQaPaperMatrix("all");

    expect(matrix).toHaveLength(34);
    expect(new Set(matrix.map((config) => config.configKey)).size).toBe(34);
    expect(matrix.filter((config) => config.subjectKey === "edexcel-combined-science")).toHaveLength(12);
    expect(matrix.filter((config) => config.subjectKey === "edexcel-mathematics-higher").map((config) => config.paperCode)).toEqual([
      "paper-1",
      "paper-2",
      "paper-3",
    ]);
  });

  it("filters by subject, subject-tier group, or exact configuration", () => {
    expect(buildQaPaperMatrix("edexcel-combined-science-higher")).toHaveLength(6);
    expect(buildQaPaperMatrix("edexcel-french-reading")).toHaveLength(2);
    expect(buildQaPaperMatrix("edexcel-french-reading-foundation-reading")).toEqual([
      expect.objectContaining({
        configKey: "edexcel-french-reading-foundation-reading",
        subjectKey: "edexcel-french-reading",
        subjectTier: "foundation",
        paperCode: "reading",
      }),
    ]);
  });

  it("rejects an unknown filter with the exact known configurations", () => {
    expect(() => buildQaPaperMatrix("unknown")).toThrow(/Known configs:.*aqa-geography-paper-1/);
  });
});
