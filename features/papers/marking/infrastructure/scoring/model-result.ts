export function normalizeScoreModelResult(
  parsed: {
    awardedMarks?: unknown;
    confidence?: unknown;
    needsReview?: unknown;
    rationale?: unknown;
    markBreakdown?: unknown;
  } | undefined,
  maxMarks: number,
) {
  const rawAwardedMarks = typeof parsed?.awardedMarks === "number" ? parsed.awardedMarks : Number.NaN;
  const rawConfidence = typeof parsed?.confidence === "number" ? parsed.confidence : Number.NaN;
  const markBreakdown = Array.isArray(parsed?.markBreakdown) ? parsed.markBreakdown : [];
  const valid = Number.isInteger(rawAwardedMarks)
    && rawAwardedMarks >= 0
    && rawAwardedMarks <= maxMarks
    && Number.isFinite(rawConfidence)
    && rawConfidence >= 0
    && rawConfidence <= 1
    && typeof parsed?.needsReview === "boolean";
  const confidence = valid ? rawConfidence : 0;

  return {
    awardedMarks: valid ? rawAwardedMarks : 0,
    confidence,
    needsReview: parsed?.needsReview === true || !valid || confidence < 0.65,
    rationale: typeof parsed?.rationale === "string" && parsed.rationale.trim()
      ? parsed.rationale.trim()
      : valid
        ? "Auto-scored against the retrieved mark scheme excerpt."
        : "The scoring model returned an invalid or incomplete result.",
    markBreakdown: markBreakdown.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) return [{ criterion: "criterion", awarded: false, evidence: "" }];
      const normalized = {
        criterion: "criterion" in entry && typeof entry.criterion === "string" ? entry.criterion : "criterion",
        awarded: "awarded" in entry && entry.awarded === true,
        evidence: "evidence" in entry && typeof entry.evidence === "string" ? entry.evidence : "",
      };
      return normalized.criterion || normalized.evidence ? [normalized] : [];
    }),
  };
}
