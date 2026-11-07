import { describe, expect, it } from "vitest";

import { buildShadowPaperInventory, type InventorySourceRecord } from "./shadow-paper-inventory";

function part(questionNumber: string, partNumber: string | null, marks: number | null, status = "validated") {
  return {
    question_number: questionNumber,
    question_part_number: partNumber,
    marks,
    marks_validated: status,
  };
}

function record(overrides: Partial<InventorySourceRecord> & Pick<InventorySourceRecord, "directory">): InventorySourceRecord {
  return {
    boardCode: "edexcel",
    subjectSlug: "mathematics",
    tier: "higher",
    paperCode: "paper-1",
    year: 2019,
    session: "june",
    coverText: "Mathematics Paper 1 (Non-Calculator) Higher Tier",
    sourcePdfSha256: "a".repeat(64),
    questionParts: [part("1", "a", 2), part("1", "b", 2), part("2", null, 3)],
    ...overrides,
  };
}

describe("shadow paper inventory", () => {
  it("assigns a canonical sitting identity and merges duplicate aliases", () => {
    const inventory = buildShadowPaperInventory([
      record({ directory: "001784-2024-paper-1-question_paper-june", year: 2024 }),
      record({ directory: "001701-2024-paper-1-question_paper-june", year: 2024 }),
    ]);

    expect(inventory.papers).toHaveLength(1);
    const [paper] = inventory.papers;
    expect(paper.sourcePaperId).toBe("edexcel-gcse-mathematics-higher-2024-june-paper-1");
    expect(paper.primaryDirectory).toBe("001701-2024-paper-1-question_paper-june");
    expect(paper.aliasDirectories).toEqual(["001784-2024-paper-1-question_paper-june"]);
    expect(paper.obstacles).toContain("duplicate-alias");
  });

  it("records the actual question and part labels separately from tagged units", () => {
    const inventory = buildShadowPaperInventory([record({ directory: "001780-2019" })]);
    const [paper] = inventory.papers;
    expect(paper.questionLabels).toEqual(["1", "2"]);
    expect(paper.partPaths).toEqual(["1(a)", "1(b)", "2"]);
    expect(paper.extractedMarks).toBe(7);
    expect(paper.status).toBe("complete");
  });

  it("marks unknown marks and missing sub-parts as incomplete instead of guessing", () => {
    const inventory = buildShadowPaperInventory([record({
      directory: "001790",
      questionParts: [part("1", "a", 2), part("1", "c", null, "unknown"), part("3", null, 2)],
    })]);
    const [paper] = inventory.papers;
    expect(paper.status).toBe("incomplete");
    expect(paper.obstacles).toEqual(expect.arrayContaining(["unknown-marks", "missing-subpart", "missing-question"]));
    expect(paper.missing).toEqual(expect.arrayContaining(["1(b)", "2"]));
  });

  it("flags conflicting calculator metadata between aliases", () => {
    const inventory = buildShadowPaperInventory([
      record({ directory: "a" }),
      record({ directory: "b", coverText: "Mathematics Paper 1 (Calculator) Higher Tier" }),
    ]);
    expect(inventory.papers[0].calculator).toBe("conflict");
    expect(inventory.papers[0].obstacles).toContain("calculator-conflict");
  });

  it("orders papers deterministically", () => {
    const inventory = buildShadowPaperInventory([
      record({ directory: "z", year: 2023, session: "november" }),
      record({ directory: "y", year: 2019 }),
      record({ directory: "x", year: 2023, session: "june" }),
    ]);
    expect(inventory.papers.map((paper) => paper.sourcePaperId)).toEqual([
      "edexcel-gcse-mathematics-higher-2019-june-paper-1",
      "edexcel-gcse-mathematics-higher-2023-june-paper-1",
      "edexcel-gcse-mathematics-higher-2023-november-paper-1",
    ]);
  });
});
