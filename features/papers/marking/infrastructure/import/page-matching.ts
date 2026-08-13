import { parseQuestionPathFromPrompt } from "../../domain/question-path";
import type { QuestionUnit } from "@/shared/domain/paper";

export const IMPORT_MATCH_THRESHOLD = 0.08;
const STRONG_PROMPT_MATCH_THRESHOLD = 0.18;

const QUESTION_PAPER_BOILERPLATE_TOKENS = new Set([
  "answer", "answers", "calculator", "do", "exam", "examination", "foundation", "higher",
  "instructions", "marks", "non", "paper", "questions", "reference", "return", "student", "tier", "turn", "write",
]);

export function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

export function tokenizeSearchText(value: string) {
  return normalizeSearchText(value).split(" ").filter((token) => token.length >= 3);
}

export function scorePromptMatch(pageText: string, promptText: string, contextText: string | null) {
  const pageTokens = new Set(tokenizeSearchText(pageText));
  const promptTokens = Array.from(new Set(tokenizeSearchText(`${promptText} ${contextText ?? ""}`))).slice(0, 40);
  if (promptTokens.length === 0) return 0;
  const overlap = promptTokens.filter((token) => pageTokens.has(token)).length;
  return overlap / promptTokens.length;
}

export function getUnitQuestionPath(unit: QuestionUnit) {
  const part = unit.parts[0];
  if (!part) return [];
  return parseQuestionPathFromPrompt(part.promptText, unit.questionNumber, part.questionPartNumber);
}

export function detectBlankQuestionPaper(params: {
  pages: Array<{ pageNumber: number; text: string }>;
  matchedUnits: QuestionUnit[];
  mergedResponses: Map<string, { text: string }>;
}) {
  const bodyPages = params.pages.slice(1);
  if (bodyPages.length === 0 || params.matchedUnits.length === 0) {
    return { isBlankQuestionPaper: false, reason: null as string | null };
  }

  const responseTokens = tokenizeSearchText(Array.from(params.mergedResponses.values()).map((entry) => entry.text).join(" "));
  const promptTokens = new Set(
    params.matchedUnits.flatMap((unit) => tokenizeSearchText([
      unit.questionNumber,
      ...unit.parts.map((part) => part.promptText),
      ...unit.parts.map((part) => part.contextText ?? ""),
    ].join(" "))),
  );

  const residualTokens = responseTokens.filter((token) => {
    if (promptTokens.has(token)) return false;
    if (QUESTION_PAPER_BOILERPLATE_TOKENS.has(token)) return false;
    if (/^page\d*$/.test(token)) return false;
    if (/^\d+$/.test(token)) return false;
    return true;
  });

  const strongPromptPages = bodyPages.filter((page) => {
    let bestScore = 0;
    for (const unit of params.matchedUnits) {
      const promptText = unit.parts.map((part) => part.promptText).join(" ");
    const contextText = unit.parts.flatMap((part) => part.contextText ? [part.contextText] : []).join(" ") || null;
      bestScore = Math.max(bestScore, scorePromptMatch(page.text, promptText, contextText));
    }
    return bestScore >= STRONG_PROMPT_MATCH_THRESHOLD;
  }).length;

  const multiQuestionPages = bodyPages.filter((page) => {
    let matchCount = 0;
    for (const unit of params.matchedUnits) {
      const promptText = unit.parts.map((part) => part.promptText).join(" ");
      const contextText = unit.parts.flatMap((part) => part.contextText ? [part.contextText] : []).join(" ") || null;
      if (scorePromptMatch(page.text, promptText, contextText) >= IMPORT_MATCH_THRESHOLD) matchCount += 1;
    }
    return matchCount >= 2;
  }).length;

  const headerText = normalizeSearchText(params.pages.slice(0, 2).map((page) => page.text).join(" "));
  const hasQuestionPaperPreamble = /(paper reference|answer all questions|higher tier|foundation tier|turn over|do not write)/.test(headerText);
  const residualRatio = responseTokens.length === 0 ? 0 : residualTokens.length / responseTokens.length;
  const looksLikeBlankQuestionPaper = hasQuestionPaperPreamble
    && strongPromptPages >= Math.max(1, Math.ceil(bodyPages.length * 0.6))
    && multiQuestionPages >= Math.max(1, Math.ceil(bodyPages.length * 0.4))
    && residualTokens.length <= Math.max(20, Math.ceil(params.matchedUnits.length * 1.5))
    && residualRatio < 0.12;

  return {
    isBlankQuestionPaper: looksLikeBlankQuestionPaper,
    reason: looksLikeBlankQuestionPaper
      ? "This PDF looks like a blank question paper, not a completed student script."
      : null,
  };
}

export function matchUnitsToPage(pageText: string, units: QuestionUnit[]) {
  return units.filter((unit) => {
    const promptText = unit.parts.map((part) => part.promptText).join(" ");
      const contextText = unit.parts.flatMap((part) => part.contextText ? [part.contextText] : []).join(" ") || null;
    return scorePromptMatch(pageText, promptText, contextText) >= IMPORT_MATCH_THRESHOLD;
  });
}
