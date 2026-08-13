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
  pageWidth?: number;
  pageHeight?: number;
};

export function normalizeInlineText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

type ColumnBoundaries = {
  answer: number;
  mark: number;
  scheme: number;
  guidance: number;
};

function inferColumnBoundaries(items: PositionedPdfItem[], pageWidth?: number): ColumnBoundaries {
  if (!pageWidth) {
    return { answer: 120, mark: 210, scheme: 250, guidance: 560 };
  }

  const scale = pageWidth / 841.89;
  const defaults = {
    answer: 72 * scale,
    mark: 166 * scale,
    scheme: 224 * scale,
    guidance: 590 * scale,
  };

  const headerStarts = new Map<string, number>();
  for (const item of items) {
    const text = item.text.trim().toLowerCase().replace(/\s+/g, " ");
    if (text === "answer" || text === "mark" || text === "marks" || text === "guidance") {
      if (!headerStarts.has(text)) headerStarts.set(text, item.x);
    }
  }

  const answerStart = headerStarts.get("answer");
  const markStart = headerStarts.get("mark") ?? headerStarts.get("marks");
  const guidanceStart = headerStarts.get("guidance");
  if (answerStart !== undefined && markStart !== undefined && guidanceStart !== undefined
    && answerStart < markStart && markStart < guidanceStart) {
    return {
      answer: Math.max(1, answerStart - 10 * scale),
      mark: Math.max(answerStart + 1, markStart - 10 * scale),
      scheme: Math.max(markStart + 1, defaults.scheme),
      guidance: Math.max(markStart + 1, guidanceStart - 10 * scale),
    };
  }

  return defaults;
}

export function buildStructuredLines(pageNumber: number, items: PositionedPdfItem[], pageWidth?: number) {
  const grouped = new Map<number, PositionedPdfItem[]>();
  const boundaries = inferColumnBoundaries(items, pageWidth);

  for (const item of items) {
    const bucket = Math.round(item.y / 3) * 3;
    const existing = grouped.get(bucket) ?? [];
    existing.push(item);
    grouped.set(bucket, existing);
  }

  const groupedEntries = Array.from(grouped.entries()).sort((a, b) => b[0] - a[0]);
  const lines: StructuredPdfLine[] = [];
  for (const [bucketY, bucketItems] of groupedEntries) {
      const sortedItems = [];
      for (const item of bucketItems) {
        if (item.text.trim().length > 0) sortedItems.push(item);
      }
      sortedItems.sort((a, b) => a.x - b.x);

      const columns = [[], [], [], [], []] as string[][];
      for (const item of sortedItems) {
        const column = item.x < boundaries.answer
          ? 0
          : item.x < boundaries.mark
            ? 1
            : item.x < boundaries.scheme
              ? 2
              : item.x < boundaries.guidance
                ? 3
                : 4;
        columns[column].push(item.text);
      }
      const [left, answer, mark, scheme, guidance] = columns;
      const leftText = normalizeInlineText(left.join(" "));
      const answerText = normalizeInlineText(answer.join(" "));
      const markText = normalizeInlineText(mark.join(" "));
      const schemeText = normalizeInlineText(scheme.join(" "));
      const guidanceText = normalizeInlineText(guidance.join(" "));
      const fullText = normalizeInlineText([leftText, answerText, markText, schemeText, guidanceText].filter(Boolean).join(" "));

      if (fullText.length > 0) lines.push({
        pageNumber,
        y: bucketY,
        leftText,
        answerText,
        markText,
        schemeText,
        guidanceText,
        fullText,
      });
  }
  return lines;
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
