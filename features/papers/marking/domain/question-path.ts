import {
  compareQuestionPaths,
  normalizeQuestionPathToken,
  parseQuestionPathFromPrompt as parseSharedQuestionPathFromPrompt,
} from "@/shared/domain/question-path";

export function normalizePartToken(token: string) {
  return normalizeQuestionPathToken(token);
}

export function parseQuestionPathFromPrompt(
  promptText: string,
  questionNumber: string,
  questionPartNumber: string | null,
): string[] {
  return parseSharedQuestionPathFromPrompt(promptText, questionNumber, questionPartNumber);
}

export function formatQuestionPathLabel(questionNumber: string, questionPath: string[]) {
  if (questionPath.length === 0) return `Question ${questionNumber}`;
  return `Question ${questionNumber} (${questionPath.join(")(")})`;
}

export function compareQuestionPath(left: string[], right: string[]) {
  return compareQuestionPaths(left, right);
}

export function compareExamQuestionOrder(
  left: { questionNumber: string; questionPath: string[] },
  right: { questionNumber: string; questionPath: string[] },
) {
  const leftNumber = Number.parseInt(left.questionNumber, 10);
  const rightNumber = Number.parseInt(right.questionNumber, 10);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
    return leftNumber - rightNumber;
  }
  const numberCompare = left.questionNumber.localeCompare(right.questionNumber, undefined, { numeric: true });
  if (numberCompare !== 0) return numberCompare;
  return compareQuestionPath(left.questionPath, right.questionPath);
}

export function partPathMatchesLine(partPath: string[], lineText: string) {
  if (partPath.length === 0) return true;
  const normalizedLine = lineText.toLowerCase();
  return partPath.every((part) => new RegExp(`\\(\\s*${part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\)`, "i").test(normalizedLine));
}

export function isPartStartLineForPath(lineText: string, partPath: string[]) {
  if (partPath.length === 0) return false;
  return partPathMatchesLine(partPath, lineText);
}

export function isSiblingPartStartLine(lineText: string, partPath: string[]) {
  if (partPath.length === 0) return false;
  const parentDepth = partPath.length - 1;
  const parentPrefix = partPath.slice(0, parentDepth);
  const matches = Array.from(lineText.matchAll(/\(\s*([a-z]|[ivx]{1,4})\s*\)/gi)).map((match) => normalizePartToken(match[1]));
  if (matches.length < partPath.length) return false;
  for (let index = 0; index < parentPrefix.length; index += 1) {
    if (matches[index] !== parentPrefix[index]) return false;
  }
  return matches[partPath.length - 1] !== partPath[partPath.length - 1];
}
