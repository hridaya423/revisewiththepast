import type { StructuredPdfLine } from "../mark-scheme/text-structure";

function normalizeInlineText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasAnswerSignal(line: string) {
  return /\d|[=+\-*/^√π×÷<>]|\b[a-z]\b/i.test(line);
}

export function formatStructuredLines(lines: StructuredPdfLine[]) {
  const mergedLines: StructuredPdfLine[] = [];

  for (const line of lines) {
    const previous = mergedLines[mergedLines.length - 1];
    const isContinuation = previous
      && !line.leftText
      && !line.answerText
      && !line.markText
      && Boolean(line.schemeText || line.guidanceText);

    if (isContinuation) {
      previous.schemeText = normalizeInlineText([previous.schemeText, line.schemeText].filter(Boolean).join(" "));
      previous.guidanceText = normalizeInlineText([previous.guidanceText, line.guidanceText].filter(Boolean).join(" "));
      previous.fullText = normalizeInlineText([
        previous.leftText,
        previous.answerText,
        previous.markText,
        previous.schemeText,
        previous.guidanceText,
      ].filter(Boolean).join(" "));
      continue;
    }

    mergedLines.push({ ...line });
  }

  return mergedLines.flatMap((line) => {
    const text = [
      line.leftText ? `Question: ${line.leftText}` : null,
      line.answerText ? `Answer: ${line.answerText}` : null,
      line.markText ? `Marks: ${line.markText}` : null,
      line.schemeText ? `Mark scheme: ${line.schemeText}` : null,
      line.guidanceText ? `Guidance: ${line.guidanceText}` : null,
    ].filter(Boolean).join(" | ");
    return text ? [text] : [];
  }).join("\n");
}

export function fallbackSlicePartText(questionText: string, questionPartNumber: string | null) {
  if (!questionPartNumber) return questionText;
  const normalizedPart = questionPartNumber.trim().toLowerCase();
  const startPattern = new RegExp(`\\(${escapeRegExp(normalizedPart)}\\)`, "i");
  const startMatch = startPattern.exec(questionText);
  if (!startMatch || startMatch.index < 0) return questionText;

  const remainder = questionText.slice(startMatch.index);
  const nextPartMatch = remainder.slice(startMatch[0].length).match(/\([a-z]\)/i);
  if (!nextPartMatch || nextPartMatch.index === undefined) return remainder.trim();
  return remainder.slice(0, startMatch[0].length + nextPartMatch.index).trim();
}

export function cleanOcrTextForScoring(promptText: string, contextText: string | null, ocrText: string) {
  const boilerplatePatterns = [
    /^page\s+\d+$/i,
    /^pmt$/i,
    /^do not write.*$/i,
    /^turn over.*$/i,
    /^answer in the spaces provided.*$/i,
    /^total for question.*$/i,
    /^total for paper.*$/i,
    /^paper:\s*1ma1/i,
    /^question\s+answer\s+mark/i,
  ];

  const promptTokens = new Set(normalizeInlineText(`${promptText} ${contextText ?? ""}`).toLowerCase().split(" ").filter((token) => token.length > 2));

  return ocrText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !boilerplatePatterns.some((pattern) => pattern.test(line)))
    .filter((line) => {
      const normalized = normalizeInlineText(line).toLowerCase();
      const tokens = normalized.split(" ").filter((token) => token.length > 2);
      if (tokens.length === 0) return hasAnswerSignal(line);
      const overlapCount = tokens.filter((token) => promptTokens.has(token)).length;
      const overlapRatio = overlapCount / tokens.length;
      if (tokens.length <= 12 && overlapRatio >= 0.75) return false;
      return true;
    })
    .join("\n")
    .trim();
}
