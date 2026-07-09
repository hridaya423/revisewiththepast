const MANUAL_REVIEW_PATTERNS = [
  /\bconstruct\b/i,
  /\bgraph\b/i,
  /\bdiagram\b/i,
  /\bplot\b/i,
  /\bshade\b/i,
  /\bdraw\b/i,
  /\bcompass/i,
  /\bgrid\b/i,
  /\bscatter\b/i,
  /\bhistogram\b/i,
  /\bbox plot\b/i,
  /\buse your graph\b/i,
  /\bon the grid\b/i,
];

function normalizeInlineText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function tokenize(text: string) {
  return normalizeInlineText(text).toLowerCase().split(" ").filter((token) => token.length > 2);
}

function hasAnswerSignal(line: string) {
  return /\d|[=+\-*/^√π×÷<>]|\b[a-z]\b/i.test(line);
}

export function requiresManualReview(promptText: string, contextText: string | null = null) {
  const combined = `${promptText}\n${contextText ?? ""}`;
  return MANUAL_REVIEW_PATTERNS.some((pattern) => pattern.test(combined));
}

export function extractAnswerRegionText(params: {
  fullOcrText: string;
  promptText: string;
  contextText?: string | null;
}) {
  const { fullOcrText, promptText, contextText = null } = params;
  const promptTokens = new Set(tokenize(`${promptText} ${contextText ?? ""}`));
  const lines = fullOcrText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const answerLines: string[] = [];
  let passedPromptBlock = false;

  for (const line of lines) {
    if (/^page\s+\d+$/i.test(line)) continue;
    if (/^pmt$/i.test(line)) continue;
    if (/^\*p\d+[a-z]\d+\*$/i.test(line.replace(/\s+/g, ""))) continue;
    if (/^turn over$/i.test(line)) continue;
    if (/^do not write outside the box/i.test(line)) continue;

    const lineTokens = tokenize(line);
    if (lineTokens.length === 0 && !hasAnswerSignal(line)) continue;

    const overlapCount = lineTokens.filter((token) => promptTokens.has(token)).length;
    const overlapRatio = overlapCount / lineTokens.length;

    if (!passedPromptBlock) {
      if (overlapRatio >= 0.6 && lineTokens.length >= 4) continue;
      if (/^\d+\s*(?:\([a-z]\)|\([ivx]+\))/i.test(line)) continue;
      passedPromptBlock = true;
    }

    if (/^total for question/i.test(line)) break;
    if (/^total for paper/i.test(line)) break;

    if (overlapRatio >= 0.85 && lineTokens.length <= 14) continue;
    if (/\.{4,}/.test(line) && line.replace(/[.\s]/g, "").length === 0) continue;

    answerLines.push(line);
  }

  const answerText = normalizeInlineText(answerLines.join("\n")) || "";

  return {
    answerText,
    rawJson: {
      fullOcrText,
      answerLines,
      extractedFrom: "answer-region-heuristic",
    },
  };
}
