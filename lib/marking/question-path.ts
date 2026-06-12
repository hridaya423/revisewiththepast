const ROMAN_PART_PATTERN = /^(i{1,3}|iv|v|vi{0,3}|ix|x)$/i;
const LETTER_PART_PATTERN = /^[a-z]$/i;

export function normalizePartToken(token: string) {
  return token.trim().toLowerCase();
}

export function parseQuestionPathFromPrompt(
  promptText: string,
  questionNumber: string,
  questionPartNumber: string | null,
): string[] {
  const trimmed = promptText.trim();
  const escapedQuestionNumber = questionNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefixMatch = trimmed.match(
    new RegExp(`^\\s*${escapedQuestionNumber}\\s*((?:\\(\\s*(?:[a-z]|[ivx]{1,4})\\s*\\)\\s*)+)`, "i"),
  );

  if (prefixMatch?.[1]) {
    const parts = Array.from(prefixMatch[1].matchAll(/\(\s*([a-z]|[ivx]{1,4})\s*\)/gi))
      .map((match) => normalizePartToken(match[1]));
    if (parts.length > 0) return parts;
  }

  if (questionPartNumber) {
    const standaloneMatch = trimmed.match(/^\(\s*([a-z]|[ivx]{1,4})\s*\)/i);
    if (standaloneMatch) {
      const token = normalizePartToken(standaloneMatch[1]);
      if (ROMAN_PART_PATTERN.test(token)) {
        return [token];
      }
      return [token];
    }
    return [normalizePartToken(questionPartNumber)];
  }

  return [];
}

export function formatQuestionPathLabel(questionNumber: string, questionPath: string[]) {
  if (questionPath.length === 0) return `Question ${questionNumber}`;
  return `Question ${questionNumber} (${questionPath.join(")(")})`;
}

export function compareQuestionPath(left: string[], right: string[]) {
  const maxLength = Math.max(left.length, right.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftToken = left[index];
    const rightToken = right[index];
    if (leftToken === undefined) return -1;
    if (rightToken === undefined) return 1;
    if (leftToken === rightToken) continue;

    const leftIsRoman = ROMAN_PART_PATTERN.test(leftToken);
    const rightIsRoman = ROMAN_PART_PATTERN.test(rightToken);
    const leftIsLetter = LETTER_PART_PATTERN.test(leftToken);
    const rightIsLetter = LETTER_PART_PATTERN.test(rightToken);

    if (leftIsLetter && rightIsRoman) return -1;
    if (leftIsRoman && rightIsLetter) return 1;
    return leftToken.localeCompare(rightToken, undefined, { numeric: true });
  }
  return 0;
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
  const lastPart = partPath[partPath.length - 1];
  return new RegExp(`\\(\\s*${lastPart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\)`, "i").test(lineText);
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
