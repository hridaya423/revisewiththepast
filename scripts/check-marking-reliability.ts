import assert from "node:assert/strict";

import { extractAnswerRegionText } from "@/features/papers/marking/domain/answer-extraction";
import { detectPageQuestionNumber } from "@/features/papers/marking/infrastructure/mark-scheme/mark-scheme";
import { isPartStartLineForPath } from "@/features/papers/marking/domain/question-path";
import { normalizeScoreModelResult } from "@/features/papers/marking/infrastructure/scoring/scoring";

const invalid = normalizeScoreModelResult({ awardedMarks: "two", confidence: "high" }, 4);
assert.equal(invalid.awardedMarks, 0);
assert.equal(invalid.confidence, 0);
assert.equal(invalid.needsReview, true);

const malformedBreakdown = normalizeScoreModelResult({
  awardedMarks: 1,
  confidence: 0.8,
  needsReview: false,
  markBreakdown: "n/a",
}, 4);
assert.deepEqual(malformedBreakdown.markBreakdown, []);

assert.equal(isPartStartLineForPath("1 (a) (i)", ["b", "i"]), false);
assert.equal(isPartStartLineForPath("1 (b) (i)", ["b", "i"]), true);

assert.equal(detectPageQuestionNumber({
  pageNumber: 1,
  text: "Guidance may mention 3(a), but this page has no question start column.",
  lines: [{ pageNumber: 1, y: 1, leftText: "", answerText: "", markText: "", schemeText: "Guidance may mention 3(a)", guidanceText: "", fullText: "Guidance may mention 3(a)" }],
}), null);

const fractional = normalizeScoreModelResult({ awardedMarks: 1.6, confidence: 0.9, needsReview: false }, 4);
assert.equal(fractional.awardedMarks, 0);
assert.equal(fractional.needsReview, true);

for (const answer of ["5", "x = 3", "πr^2", "-2"]) {
  const result = extractAnswerRegionText({
    fullOcrText: answer,
    promptText: "Work out the value.",
  });
  assert.equal(result.answerText, answer);
}

console.log("marking reliability checks passed");
