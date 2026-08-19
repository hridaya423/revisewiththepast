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

type ColumnName = "left" | "answer" | "mark" | "scheme" | "guidance";
type ColumnLayout = Array<{ column: ColumnName; start: number }>;

function inferColumnLayout(items: PositionedPdfItem[], pageWidth?: number): ColumnLayout {
  if (!pageWidth) {
    return [
      { column: "left", start: -Infinity },
      { column: "answer", start: 120 },
      { column: "mark", start: 210 },
      { column: "scheme", start: 250 },
      { column: "guidance", start: 560 },
    ];
  }

  const scale = pageWidth / 841.89;
  const defaults: ColumnLayout = [
    { column: "left", start: -Infinity },
    { column: "answer", start: 72 * scale },
    { column: "mark", start: 166 * scale },
    { column: "scheme", start: 224 * scale },
    { column: "guidance", start: 590 * scale },
  ];

  const headerStarts = new Map<Exclude<ColumnName, "left">, number>();
  for (const item of items) {
    const text = item.text.trim().toLowerCase().replace(/\s+/g, " ");
    const column = text === "answer"
      ? "answer"
      : text === "mark" || text === "marks"
        ? "mark"
        : text === "scheme" || text === "mark scheme"
          ? "scheme"
          : text.endsWith("guidance")
            ? "guidance"
            : null;
    if (column && !headerStarts.has(column)) headerStarts.set(column, item.x);
  }

  const answerStart = headerStarts.get("answer");
  const markStart = headerStarts.get("mark");
  const schemeStart = headerStarts.get("scheme");
  const guidanceStart = headerStarts.get("guidance");
  if (answerStart !== undefined && markStart !== undefined && (schemeStart !== undefined || guidanceStart !== undefined)) {
    const layout: ColumnLayout = [
      { column: "left", start: -Infinity },
      ...Array.from(headerStarts, ([column, start]) => ({
        column,
        start: Math.max(1, start - 10 * scale),
      })),
    ];
    return layout.sort((left, right) => left.start - right.start);
  }

  return defaults;
}

export function buildStructuredLines(pageNumber: number, items: PositionedPdfItem[], pageWidth?: number) {
  const grouped = new Map<number, PositionedPdfItem[]>();
  const layout = inferColumnLayout(items, pageWidth);

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

      const columns: Record<ColumnName, string[]> = { left: [], answer: [], mark: [], scheme: [], guidance: [] };
      for (const item of sortedItems) {
        let column: ColumnName = "left";
        for (const candidate of layout) {
          if (item.x < candidate.start) break;
          column = candidate.column;
        }
        columns[column].push(item.text);
      }
      const leftText = normalizeInlineText(columns.left.join(" "));
      const answerText = normalizeInlineText(columns.answer.join(" "));
      const markText = normalizeInlineText(columns.mark.join(" "));
      const schemeText = normalizeInlineText(columns.scheme.join(" "));
      const guidanceText = normalizeInlineText(columns.guidance.join(" "));
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
