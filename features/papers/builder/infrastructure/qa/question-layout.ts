import { getPdfDocument } from "@/features/papers/infrastructure/pdfjs-server";
import { PDFDocument } from "pdf-lib";
import { GENERATED_PAGE } from "../../domain/generated-layout";
import { getGeneratedPageRole } from "../pdf/page-chrome";
import type { QaFinding } from "./validate";

export type QuestionLayoutOptions = {
  expectedOrdinalCount?: number;
  selectedUnitCount?: number;
};

type TextGeometry = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  left: number;
  right: number;
  bottom: number;
  top: number;
};

function isTextItem(item: unknown): item is { str: string; transform: number[]; width: number } {
  if (typeof item !== "object" || item === null) return false;
  if (!("str" in item) || typeof item.str !== "string") return false;
  if (!("transform" in item) || !Array.isArray(item.transform)) return false;
  if (!item.transform.every((value) => typeof value === "number")) return false;
  return "width" in item && typeof item.width === "number";
}

function toGeometry(item: { str: string; transform: number[]; width: number }): TextGeometry | null {
  const [a, b, c, d, x, y] = item.transform;
  if ([a, b, c, d, x, y].some((value) => typeof value !== "number" || !Number.isFinite(value))) return null;
  const height = Math.hypot(c, d);
  const advanceLength = Math.hypot(a, b);
  if (!Number.isFinite(height) || height <= 0 || !Number.isFinite(item.width) || item.width < 0) return null;
  if (!Number.isFinite(advanceLength) || advanceLength <= 0) return null;
  const advanceX = (a / advanceLength) * item.width;
  const advanceY = (b / advanceLength) * item.width;
  const verticalX = c;
  const verticalY = d;
  const points = [
    { x, y },
    { x: x + advanceX, y: y + advanceY },
    { x: x - verticalX, y: y - verticalY },
    { x: x + advanceX - verticalX, y: y + advanceY - verticalY },
  ];
  return {
    text: item.str.trim(),
    x,
    y,
    width: item.width,
    height,
    left: Math.min(...points.map((point) => point.x)),
    right: Math.max(...points.map((point) => point.x)),
    bottom: Math.min(...points.map((point) => point.y)),
    top: Math.max(...points.map((point) => point.y)),
  };
}

function finding(message: string, pageNumber: number): QaFinding {
  return { check: "question-layout", severity: "error", pageNumber, message };
}

function intersects(first: TextGeometry, second: TextGeometry): boolean {
  return first.left < second.right
    && first.right > second.left
    && first.bottom < second.top
    && first.top > second.bottom;
}

const SOURCE_FURNITURE = /total for (?:question|section|paper)|do not write|outside the box|turn over|^\*?[a-z]?\d{6,}[a-z]?\*?$|(?:[a-z]+\/)?(?:\d+\/){1,}\d+/i;

export async function checkQuestionLayout(
  pdfBytes: Uint8Array,
  options: QuestionLayoutOptions,
): Promise<QaFinding[]> {
  const expectedCount = options.expectedOrdinalCount ?? options.selectedUnitCount;
  if (!expectedCount || expectedCount < 1) return [];

  const [document, roleDocument] = await Promise.all([
    getPdfDocument(pdfBytes.slice()),
    PDFDocument.load(pdfBytes),
  ]);
  const roles = roleDocument.getPages().map(getGeneratedPageRole);
  const candidates: Array<{ value: number; pageNumber: number; geometry: TextGeometry }> = [];
  const findings: QaFinding[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const pageBounds = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();
    const geometries = textContent.items
      .map((item) => isTextItem(item) ? toGeometry(item) : null)
      .filter((geometry): geometry is TextGeometry => geometry !== null);
    if (roles[pageNumber - 1] !== "question-content") continue;

    for (const geometry of geometries) {
      if (!SOURCE_FURNITURE.test(geometry.text)) continue;
      if (geometry.right <= 0 || geometry.left >= GENERATED_PAGE.contentLeft) continue;
      findings.push(finding(`source warning or furniture "${geometry.text}" occupies the generated number column`, pageNumber));
    }

    for (const geometry of geometries) {
      if (!/^\d+$/.test(geometry.text)) continue;
      const value = Number(geometry.text);
      if (!Number.isSafeInteger(value) || value <= 0) continue;
      if (geometry.x < -20 || geometry.x >= GENERATED_PAGE.contentLeft) continue;
      if (Math.abs(geometry.height - GENERATED_PAGE.numberFontSize) > 1.5) continue;

      candidates.push({ value, pageNumber, geometry });
      if (Math.abs(geometry.x - GENERATED_PAGE.numberX) > 1.5) {
        findings.push(finding(`ordinal ${value} has x position ${geometry.x.toFixed(2)} on page ${pageNumber}, expected ${GENERATED_PAGE.numberX}`, pageNumber));
      }

      if (geometry.left < GENERATED_PAGE.numberX
        || geometry.right > GENERATED_PAGE.contentLeft) {
        findings.push(finding(`ordinal ${value} is outside the generated number column at x ${geometry.x.toFixed(2)} on page ${pageNumber}`, pageNumber));
      }
      if (geometry.left < 0
        || geometry.right > pageBounds.width
        || geometry.bottom < 0
        || geometry.top > pageBounds.height) {
        findings.push(finding(`ordinal ${value} is outside generated page bounds on page ${pageNumber} at (${geometry.x.toFixed(2)}, ${geometry.y.toFixed(2)})`, pageNumber));
      }

      const contentItems = geometries.filter((item) => item !== geometry && item.left >= GENERATED_PAGE.contentLeft);
      if (contentItems.some((item) => intersects(geometry, item))) {
        findings.push(finding(`ordinal ${value} overlaps content on page ${pageNumber} at (${geometry.x.toFixed(2)}, ${geometry.y.toFixed(2)})`, pageNumber));
      }
    }
  }

  const byValue = new Map<number, typeof candidates>();
  for (const candidate of candidates) {
    const matches = byValue.get(candidate.value) ?? [];
    matches.push(candidate);
    byValue.set(candidate.value, matches);
  }

  for (let value = 1; value <= expectedCount; value += 1) {
    const matches = byValue.get(value) ?? [];
    if (matches.length === 0) {
      findings.push(finding(`missing ordinal ${value}`, 0));
    } else if (matches.length > 1) {
      const locations = matches.map((match) => `page ${match.pageNumber} (${match.geometry.x.toFixed(2)}, ${match.geometry.y.toFixed(2)})`).join(", ");
      findings.push(finding(`ordinal ${value} appears ${matches.length} times at ${locations}`, matches[0]?.pageNumber ?? 0));
    }
  }

  for (const candidate of candidates) {
    if (candidate.value >= 1 && candidate.value <= expectedCount) continue;
    findings.push(finding(`unexpected ordinal ${candidate.value} at (${candidate.geometry.x.toFixed(2)}, ${candidate.geometry.y.toFixed(2)})`, candidate.pageNumber));
  }

  return findings;
}
