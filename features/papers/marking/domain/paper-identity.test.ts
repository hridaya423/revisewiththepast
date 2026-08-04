import { describe, expect, it } from "vitest";
import type { QuestionUnit } from "@/shared/domain/paper";
import { detectPaperIdentityFromPages } from "./paper-identity";

const candidateUnit = {
  boardCode: "edexcel",
  subjectSlug: "mathematics",
  sourceRelativePath: "edexcel/mathematics/higher/2023/june/paper-2.json",
  paperCode: "paper-2",
  year: 2023,
  session: "june",
} as QuestionUnit;

describe("marking paper identity", () => {
  it("recognizes exam reference, session, year, and tier", () => {
    expect(detectPaperIdentityFromPages([
      { text: "Pearson Edexcel GCSE Mathematics\n1MA1/2H\nJune 2023\nHigher Tier" },
    ], [candidateUnit])).toMatchObject({
      paperCode: "paper-2",
      year: 2023,
      session: "june",
      tier: "higher",
    });
  });

  it("resolves a non-maths subject from the candidate bank", () => {
    const businessUnit = {
      boardCode: "aqa",
      subjectSlug: "business",
      sourceRelativePath: "aqa/business/none/2024/june/paper-1.json",
      paperCode: "paper-1",
      year: 2024,
      session: "june",
    } as QuestionUnit;

    expect(detectPaperIdentityFromPages([
      { text: "AQA GCSE Business 8132 Paper 1 June 2024" },
    ], [businessUnit])).toMatchObject({
      subjectKey: "aqa-business",
      paperCode: "paper-1",
      year: 2024,
      session: "june",
    });
  });
});
