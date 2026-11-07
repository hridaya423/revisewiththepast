import { describe, expect, it } from "vitest";

import { detectPaperIdentityFromPages } from "@/features/papers/marking/domain/paper-identity";
import type { QuestionUnit } from "@/shared/domain/paper";
import { shadowMarkerText } from "../domain/marker";
import { detectShadowVariantInPages, isShadowSavedPaper } from "./marking-boundary";

const ORIGINAL_HEADER = "Pearson Edexcel Level 1/Level 2 GCSE (9–1) Mathematics Paper 1 (Non-Calculator) Higher Tier Tuesday 21 May 2019 Paper Reference 1MA1/1H";

const unit = {
  unitKey: "edexcel-maths-2019-june-1h-q1",
  boardCode: "edexcel",
  subjectSlug: "mathematics",
  paperCode: "paper-1",
  year: 2019,
  session: "june",
  sourceRelativePath: "edexcel/mathematics/higher/2019-june-paper-1.pdf",
  totalMarks: 2,
} as unknown as QuestionUnit;

describe("shadow marking boundary", () => {
  it("treats saved shadow variants as not automatically markable", () => {
    expect(isShadowSavedPaper({ generationKind: "shadow" })).toBe(true);
    expect(isShadowSavedPaper({ generationKind: "builder" })).toBe(false);
    expect(isShadowSavedPaper({})).toBe(false);
    expect(isShadowSavedPaper(null)).toBe(false);
  });

  it("finds the printed marker on any page, including after text extraction reflows it", () => {
    const marker = shadowMarkerText("paper", "SH-ABCD-EFGH").replace(" ", "\n  ");
    expect(detectShadowVariantInPages([{ text: "Answer ALL questions." }, { text: `Question 4 ... ${marker}` }])).toBe("SH-ABCD-EFGH");
    expect(detectShadowVariantInPages([{ text: shadowMarkerText("mark-scheme", "SH-2345-WXYZ") }])).toBe("SH-2345-WXYZ");
    expect(detectShadowVariantInPages([{ text: ORIGINAL_HEADER }])).toBeNull();
  });

  it("never resolves a shadow upload to the original paper it shadows, even though it repeats the source identity", () => {
    const shadowCover = `${shadowMarkerText("paper", "SH-ABCD-EFGH")} Shadow of ${ORIGINAL_HEADER}`;
    expect(detectPaperIdentityFromPages([{ text: ORIGINAL_HEADER }], [unit])).not.toBeNull();
    expect(detectPaperIdentityFromPages([{ text: shadowCover }], [unit])).toBeNull();
  });
});
