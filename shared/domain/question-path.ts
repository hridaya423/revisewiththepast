const PART_TOKEN = "[a-z]|[ivx]{1,4}";
const ROMAN_TOKEN_VALUES: Record<string, number> = {
  i: 1,
  ii: 2,
  iii: 3,
  iv: 4,
  v: 5,
  vi: 6,
  vii: 7,
  viii: 8,
  ix: 9,
  x: 10,
};

export function normalizeQuestionPathToken(token: string) {
  return token.trim().toLowerCase();
}

export function parseQuestionPathFromPrompt(
  promptText: string,
  questionNumber: string,
  questionPartNumber: string | null,
): string[] {
  const trimmed = promptText.trim();
  const parsedQuestion = Number.parseInt(questionNumber, 10);
  const escapedQuestion = Number.isFinite(parsedQuestion)
    ? `0?\\s*${parsedQuestion}`
    : questionNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefix = trimmed.match(
    new RegExp(`^\\s*${escapedQuestion}\\s*((?:\\(\\s*(?:${PART_TOKEN})\\s*\\)\\s*)+)`, "i"),
  );
  if (prefix?.[1]) {
    const tokens = Array.from(prefix[1].matchAll(new RegExp(`\\(\\s*(${PART_TOKEN})\\s*\\)`, "gi")))
      .map((match) => normalizeQuestionPathToken(match[1]));
    if (tokens.length > 0) return tokens;
  }

  if (questionPartNumber) return [normalizeQuestionPathToken(questionPartNumber)];
  return [];
}

export function formatQuestionPath(questionNumber: string, questionPath: string[]) {
  if (questionPath.length === 0) return questionNumber;
  return `${questionNumber} ${questionPath.map((token) => `(${token})`).join(" ")}`;
}

export function compareQuestionPaths(left: string[], right: string[]) {
  const maxLength = Math.max(left.length, right.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftToken = left[index];
    const rightToken = right[index];
    if (leftToken === undefined) return -1;
    if (rightToken === undefined) return 1;
    if (leftToken === rightToken) continue;

    const leftRomanValue = ROMAN_TOKEN_VALUES[leftToken];
    const rightRomanValue = ROMAN_TOKEN_VALUES[rightToken];
    const leftIsRoman = leftRomanValue !== undefined;
    const rightIsRoman = rightRomanValue !== undefined;
    const leftIsLetter = /^[a-z]$/i.test(leftToken) && !leftIsRoman;
    const rightIsLetter = /^[a-z]$/i.test(rightToken) && !rightIsRoman;
    if (leftIsRoman && rightIsRoman) return leftRomanValue - rightRomanValue;
    if (leftIsLetter && rightIsRoman) return -1;
    if (leftIsRoman && rightIsLetter) return 1;
    return leftToken.localeCompare(rightToken, undefined, { numeric: true });
  }
  return 0;
}
