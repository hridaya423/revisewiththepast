
import type { QuestionUnit, RegionSpan } from "@/lib/paper-maker/aqa-geography";

export type RegionCropKind = "stem" | "figure" | "question";

export type RegionCropBox = { left: number; right: number; bottom: number; top: number };

export type RegionCrop = {
  unitKey: string;
  sourceRelativePath: string;
  pageNumber: number;
  cropBox: RegionCropBox;
  kind: RegionCropKind;
};

export type RegionPageLayout = {
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
  contentX0: number;
  contentX1: number;
  headerFloorY: number;
  footerCeilingY: number;
};

export type RegionFigure = {
  label: string;
  pageNumber: number;
  yTop: number;
  yBottom: number;
};

const CONTENT_X_PADDING = 16;
const CONTIGUOUS_MERGE_GAP = 40;

function spanKey(pageNumber: number, yTop: number, yBottom: number) {
  return `${pageNumber}:${Math.round(yTop)}:${Math.round(yBottom)}`;
}

function dedupeSpans(spans: RegionSpan[]): RegionSpan[] {
  const seen = new Set<string>();
  const out: RegionSpan[] = [];
  for (const span of spans) {
    const key = spanKey(span.pageNumber, span.yTop, span.yBottom);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(span);
  }
  return out;
}

function figureCoveredBySpans(figure: RegionFigure, spans: RegionSpan[]): boolean {
  const figureHeight = figure.yTop - figure.yBottom;
  if (figureHeight <= 0) return true;
  for (const span of spans) {
    if (span.pageNumber !== figure.pageNumber) continue;
    const overlap = Math.min(span.yTop, figure.yTop) - Math.max(span.yBottom, figure.yBottom);
    if (overlap > figureHeight * 0.9) return true;
  }
  return false;
}

const ORPHAN_FIGURE_SPAN_COVERAGE = 0.5;

function figureCoverageOfSpan(
  figure: RegionFigure,
  span: { pageNumber: number; yTop: number; yBottom: number },
): number {
  if (span.pageNumber !== figure.pageNumber) return 0;
  const spanHeight = span.yTop - span.yBottom;
  if (spanHeight <= 0) return 0;
  const overlap = Math.min(span.yTop, figure.yTop) - Math.max(span.yBottom, figure.yBottom);
  return overlap > 0 ? overlap / spanHeight : 0;
}

function isScienceUnit(unit: QuestionUnit) {
  return ["combined-science", "biology", "chemistry", "physics"].includes(unit.subjectSlug);
}

function shouldTrimExamGutter(unit: QuestionUnit) {
  return unit.boardCode === "edexcel" || unit.boardCode === "ocr";
}

function cropBoxForSpan(
  span: { yTop: number; yBottom: number },
  layout: RegionPageLayout,
  unit: QuestionUnit,
): RegionCropBox {
  const isWideSciencePage = isScienceUnit(unit) && layout.pageWidth > 620;
  const trimGutter = shouldTrimExamGutter(unit);
  const left = isWideSciencePage
    ? Math.max(0, layout.contentX0 - CONTENT_X_PADDING)
    : trimGutter
      ? Math.max(0, layout.contentX0 - CONTENT_X_PADDING)
    : Math.max(0, layout.contentX0 - CONTENT_X_PADDING);
  const right = isWideSciencePage
    ? Math.min(layout.contentX1, layout.pageWidth - 32)
    : trimGutter
      ? Math.min(layout.pageWidth, layout.contentX1 + CONTENT_X_PADDING)
    : unit.boardCode === "aqa"
      ? Math.min(layout.pageWidth, layout.pageWidth - 8)
      : Math.min(layout.pageWidth, layout.contentX1 + CONTENT_X_PADDING);

  return {
    left,
    right,
    bottom: Math.max(layout.footerCeilingY, span.yBottom),
    top: Math.min(layout.pageHeight, layout.headerFloorY > 0 ? layout.headerFloorY : layout.pageHeight, span.yTop),
  };
}

export function isUnitRegionRenderable(
  unit: QuestionUnit,
  layoutByPage: Map<number, RegionPageLayout>,
): boolean {
  let sawSpan = false;
  for (const part of unit.parts) {
    if (!part.regionSpans || part.regionSpans.length === 0) {
      if (!part.stemSpans || part.stemSpans.length === 0) return false;
      for (const span of part.stemSpans) {
        if (!layoutByPage.has(span.pageNumber)) return false;
      }
      continue;
    }
    for (const span of part.regionSpans) {
      sawSpan = true;
      if (!layoutByPage.has(span.pageNumber)) return false;
    }
    for (const span of part.stemSpans ?? []) {
      if (!layoutByPage.has(span.pageNumber)) return false;
    }
  }
  return sawSpan;
}

export function buildUnitRenderPlan(
  unit: QuestionUnit,
  layoutByPage: Map<number, RegionPageLayout>,
  figures: RegionFigure[],
): RegionCrop[] {
  const questionSpans = dedupeSpans(unit.parts.flatMap((part) => part.regionSpans ?? []));

  const referenced = new Set<string>();
  for (const part of unit.parts) {
    for (const label of part.referencedFigures ?? []) referenced.add(label);
  }

  const unreferencedFigures = figures.filter((figure) => !referenced.has(figure.label));
  const questionPages = new Set(questionSpans.map((span) => span.pageNumber));
  const referencedFigurePages = new Set(figures.filter((figure) => referenced.has(figure.label)).map((figure) => figure.pageNumber));
  const stemSpans = dedupeSpans(unit.parts.flatMap((part) => part.stemSpans ?? [])).filter(
    (span) => !unreferencedFigures.some((figure) => figureCoverageOfSpan(figure, span) > ORPHAN_FIGURE_SPAN_COVERAGE),
  ).filter(
    (span) => !isScienceUnit(unit) || referenced.size === 0 || questionPages.has(span.pageNumber) || referencedFigurePages.has(span.pageNumber),
  );
  const allRenderedSpans = [...questionSpans, ...stemSpans];

  const figureByLabel = new Map<string, RegionFigure>();
  for (const figure of figures) {
    if (!figureByLabel.has(figure.label)) figureByLabel.set(figure.label, figure);
  }
  const extraFigures: RegionFigure[] = [];
  for (const label of referenced) {
    const figure = figureByLabel.get(label);
    if (!figure) continue;
    if (!layoutByPage.has(figure.pageNumber)) continue;
    if (figureCoveredBySpans(figure, allRenderedSpans)) continue;
    extraFigures.push(figure);
  }

  type Entry = { pageNumber: number; top: number; bottom: number; kind: RegionCropKind };
  const entries: Entry[] = [
    ...stemSpans.map((s) => ({ pageNumber: s.pageNumber, top: s.yTop, bottom: s.yBottom, kind: "stem" as const })),
    ...extraFigures.map((f) => ({ pageNumber: f.pageNumber, top: f.yTop, bottom: f.yBottom, kind: "figure" as const })),
    ...questionSpans.map((s) => ({ pageNumber: s.pageNumber, top: s.yTop, bottom: s.yBottom, kind: "question" as const })),
  ];

  const kindRank: Record<RegionCropKind, number> = { stem: 0, figure: 1, question: 2 };
  entries.sort((a, b) => {
    if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
    if (Math.abs(a.top - b.top) > 1) return b.top - a.top;
    return kindRank[a.kind] - kindRank[b.kind];
  });

  let lastQuestionIndex = -1;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i].kind === "question") { lastQuestionIndex = i; break; }
  }
  const trimmed = lastQuestionIndex >= 0
    ? entries.filter((entry, index) => entry.kind === "question" || index < lastQuestionIndex)
    : entries.filter((entry) => entry.kind === "question");

  const merged: Entry[] = [];
  for (const entry of trimmed) {
    const last = merged[merged.length - 1];
    if (last && last.pageNumber === entry.pageNumber && last.bottom - entry.top <= CONTIGUOUS_MERGE_GAP) {
      last.top = Math.max(last.top, entry.top);
      last.bottom = Math.min(last.bottom, entry.bottom);
      if (entry.kind === "question") last.kind = "question";
    } else {
      merged.push({ ...entry });
    }
  }

  const crops: RegionCrop[] = [];
  for (const entry of merged) {
    const layout = layoutByPage.get(entry.pageNumber);
    if (!layout) continue;
    const cropBox = cropBoxForSpan({ yTop: entry.top, yBottom: entry.bottom }, layout, unit);
    if (cropBox.top - cropBox.bottom < 8) continue;
    crops.push({
      unitKey: unit.unitKey,
      sourceRelativePath: unit.sourceRelativePath,
      pageNumber: entry.pageNumber,
      cropBox,
      kind: entry.kind,
    });
  }
  return crops;
}

export type OrphanFigureIssue = {
  unitKey: string;
  figureLabel: string;
  pageNumber: number;
};

export function findOrphanStemFigures(
  unit: QuestionUnit,
  layoutByPage: Map<number, RegionPageLayout>,
  figures: RegionFigure[],
): OrphanFigureIssue[] {
  const referenced = new Set<string>();
  for (const part of unit.parts) {
    for (const label of part.referencedFigures ?? []) referenced.add(label);
  }
  const unreferenced = figures.filter((figure) => !referenced.has(figure.label));
  if (unreferenced.length === 0) return [];

  const plan = buildUnitRenderPlan(unit, layoutByPage, figures).filter((crop) => crop.kind === "stem");
  const issues: OrphanFigureIssue[] = [];
  for (const figure of unreferenced) {
    if (figure.yTop - figure.yBottom <= 0) continue;
    for (const crop of plan) {
      const coverage = figureCoverageOfSpan(figure, {
        pageNumber: crop.pageNumber,
        yTop: crop.cropBox.top,
        yBottom: crop.cropBox.bottom,
      });
      if (coverage > ORPHAN_FIGURE_SPAN_COVERAGE) {
        issues.push({ unitKey: unit.unitKey, figureLabel: figure.label, pageNumber: figure.pageNumber });
        break;
      }
    }
  }
  return issues;
}
