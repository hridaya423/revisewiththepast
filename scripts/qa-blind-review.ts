export type BlindArtifact = "question-paper" | "mark-scheme";

export type BlindReviewPair = {
  pairId: string;
  artifact: BlindArtifact;
  generatedPage: number;
  referencePage: number;
  reviewMode: "blind" | "visual";
  status: "pending" | "pass" | "fail";
};

export type BlindReviewKey = {
  pairId: string;
  oursSide: "A" | "B";
};

export function pairEveryGeneratedPage(generatedPageCount: number, referencePageCount: number) {
  if (generatedPageCount < 1 || referencePageCount < 1) return [];
  return Array.from({ length: generatedPageCount }, (_, index) => ({
    generatedPage: index + 1,
    referencePage: generatedPageCount === 1
      ? 1
      : Math.round(index * (referencePageCount - 1) / (generatedPageCount - 1)) + 1,
  }));
}

export function blindPairMetadata(input: {
  pairId: string;
  artifact: BlindArtifact;
  generatedPage: number;
  referencePage: number;
  oursFirst: boolean;
  reviewMode: BlindReviewPair["reviewMode"];
}) {
  return {
    review: {
      pairId: input.pairId,
      artifact: input.artifact,
      generatedPage: input.generatedPage,
      referencePage: input.referencePage,
      reviewMode: input.reviewMode,
      status: "pending",
    } satisfies BlindReviewPair,
    key: {
      pairId: input.pairId,
      oursSide: input.oursFirst ? "A" : "B",
    } satisfies BlindReviewKey,
  };
}

export function decideBlindReviewGate(pairs: readonly BlindReviewPair[]) {
  const failures = pairs.flatMap((pair) => pair.status === "pass"
    ? []
    : [`visual-review-${pair.status === "pending" ? "pending" : "failed"}:${pair.pairId}`]);
  if (pairs.length === 0) failures.push("visual-review-empty");
  return { ok: failures.length === 0, failures };
}
