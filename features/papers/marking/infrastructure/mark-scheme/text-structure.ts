export type PositionedPdfItem = {
  text: string;
  x: number;
  y: number;
};

export type StructuredPdfLine = {
  pageNumber: number;
  y: number;
  leftText: string;
  answerText: string;
  markText: string;
  schemeText: string;
  guidanceText: string;
  fullText: string;
};

export type CachedPdfPage = {
  pageNumber: number;
  text: string;
  lines: StructuredPdfLine[];
};

export function normalizeInlineText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

export function buildStructuredLines(pageNumber: number, items: PositionedPdfItem[]) {
  const grouped = new Map<number, PositionedPdfItem[]>();

  for (const item of items) {
    const bucket = Math.round(item.y / 3) * 3;
    const existing = grouped.get(bucket) ?? [];
    existing.push(item);
    grouped.set(bucket, existing);
  }

  return Array.from(grouped.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([bucketY, bucketItems]) => {
      const sortedItems = [...bucketItems]
        .filter((item) => item.text.trim().length > 0)
        .sort((a, b) => a.x - b.x);

      const leftText = normalizeInlineText(sortedItems.filter((item) => item.x < 120).map((item) => item.text).join(" "));
      const answerText = normalizeInlineText(sortedItems.filter((item) => item.x >= 120 && item.x < 210).map((item) => item.text).join(" "));
      const markText = normalizeInlineText(sortedItems.filter((item) => item.x >= 210 && item.x < 250).map((item) => item.text).join(" "));
      const schemeText = normalizeInlineText(sortedItems.filter((item) => item.x >= 250 && item.x < 560).map((item) => item.text).join(" "));
      const guidanceText = normalizeInlineText(sortedItems.filter((item) => item.x >= 560).map((item) => item.text).join(" "));
      const fullText = normalizeInlineText([leftText, answerText, markText, schemeText, guidanceText].filter(Boolean).join(" "));

      return {
        pageNumber,
        y: bucketY,
        leftText,
        answerText,
        markText,
        schemeText,
        guidanceText,
        fullText,
      } satisfies StructuredPdfLine;
    })
    .filter((line) => line.fullText.length > 0);
}

export function normalizeQuestionNumber(token: string) {
  const parsed = parseInt(token, 10);
  return Number.isFinite(parsed) ? String(parsed) : token.trim();
}

function detectLeftColumnQuestionNumber(lines: StructuredPdfLine[]): string | null {
  for (const line of lines) {
    const left = line.leftText.trim();
    if (!left) continue;
    const grid = left.match(/^(\d{1,2})\s*[.\s]\s*\d{1,2}\s*\([a-z]/i);
    if (grid) return normalizeQuestionNumber(grid[1]);
    const part = left.match(/^(\d{1,2})\s*\([a-z]\)/i);
    if (part) return normalizeQuestionNumber(part[1]);
  }
  return null;
}

export function pageHasQuestionStart(page: CachedPdfPage, questionNumber: string) {
  return page.lines.some((line) => detectLeftColumnQuestionNumber([line]) === questionNumber);
}

export function detectOcrComputerScienceQuestionStart(page: CachedPdfPage, questionNumber: string) {
  if (/\bMARKING INSTRUCTIONS\b|\bPREPARATION FOR MARKING\b|\bAnnotations\s+Annotation\s+Meaning\b|\bSubject Specific Marking Instructions\b/i.test(page.text)) return false;
  const tableHeader = new RegExp(`\\bQuestion\\s+Answer\\s+Mark\\s+Guidance\\s+${questionNumber}\\b`, "i");
  const partRow = new RegExp(`(?:^|\\s)${questionNumber}\\s+[a-z]\\s+(?:i{1,3}|iv|v|[a-z])\\b|(?:^|\\s)${questionNumber}\\s*\\([a-z]\\)`, "i");
  return tableHeader.test(page.text) || partRow.test(page.text);
}

export function detectPageQuestionNumber(page: CachedPdfPage): string | null {
  const headerMatch = page.text.match(/Additional guidance\s+(\d+)\b/i);
  if (headerMatch) return normalizeQuestionNumber(headerMatch[1]);
  return detectLeftColumnQuestionNumber(page.lines);
}
