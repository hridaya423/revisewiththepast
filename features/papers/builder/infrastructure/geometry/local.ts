import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { QuestionBankPart } from "@/shared/domain/paper";
import { getServerEnvironment } from "@/shared/infrastructure/env/server";
import type { RegionFigure, RegionPageLayout } from "../../domain/region-render";

export function isLocalGeometryEnabled() {
  return Boolean(getServerEnvironment().PAPER_MAKER_LOCAL_GEOMETRY);
}

type LocalSpan = { page_number: number; y_top: number; y_bottom: number };
type LocalPart = {
  question_id: string;
  region_spans?: LocalSpan[] | null;
  stem_spans?: LocalSpan[] | null;
  referenced_support_labels?: string[];
};
type LocalPaper = {
  figures?: Array<{ label: string; page_number: number; y_top: number; y_bottom: number }>;
  page_layouts?: Array<{
    page_number: number;
    page_width: number;
    page_height: number;
    content_x0: number;
    content_x1: number;
    header_floor_y: number;
    footer_ceiling_y: number;
  }>;
  question_parts?: LocalPart[];
};

const paperCache = new Map<string, LocalPaper | null>();

function deriveExtractedPaperJsonPath(sourceRelativePath: string) {
  const segments = sourceRelativePath.replaceAll("\\", "/").split("/").filter(Boolean);
  const boardCode = segments[0] ?? "";
  const subjectSlug = segments[1] ?? "";
  const extraDirs = segments.slice(2, -1).filter((segment) => segment !== "none");
  const fileName = segments.at(-1) ?? sourceRelativePath;
  const paperDirName = fileName.replace(/\.pdf$/i, "");
  return resolve(process.cwd(), "data/extracted", boardCode, subjectSlug, ...extraDirs, paperDirName, "paper.json");
}

function loadLocalPaper(sourceRelativePath: string): LocalPaper | null {
  if (paperCache.has(sourceRelativePath)) return paperCache.get(sourceRelativePath) ?? null;
  const filePath = deriveExtractedPaperJsonPath(sourceRelativePath);
  let paper: LocalPaper | null = null;
  if (existsSync(filePath)) {
    try {
      paper = JSON.parse(readFileSync(filePath, "utf8")) as LocalPaper;
    } catch {
      paper = null;
    }
  }
  paperCache.set(sourceRelativePath, paper);
  return paper;
}

const mapSpans = (spans?: LocalSpan[] | null) =>
  spans ? spans.map((span) => ({ pageNumber: span.page_number, yTop: span.y_top, yBottom: span.y_bottom })) : null;

export function overlayQuestionBankWithLocalGeometry(parts: QuestionBankPart[]) {
  let matched = 0;
  let unmatched = 0;
  const partMapByPath = new Map<string, Map<string, LocalPart>>();
  for (const part of parts) {
    let partMap = partMapByPath.get(part.sourceRelativePath);
    if (!partMap) {
      partMap = new Map<string, LocalPart>();
      for (const localPart of loadLocalPaper(part.sourceRelativePath)?.question_parts ?? []) {
        partMap.set(localPart.question_id, localPart);
      }
      partMapByPath.set(part.sourceRelativePath, partMap);
    }
    const local = partMap.get(part.questionId);
    if (!local) {
      unmatched += 1;
      continue;
    }
    matched += 1;
    part.regionSpans = mapSpans(local.region_spans);
    part.stemSpans = mapSpans(local.stem_spans);
    part.referencedFigures = local.referenced_support_labels ?? [];
  }
  if (getServerEnvironment().LOCAL_GEOMETRY_DEBUG) {
    console.warn(`[local-geometry] overlay matched ${matched}/${matched + unmatched} parts by questionId`);
  }
}

export function getLocalFiguresBySource(sourceRelativePaths: string[]): Map<string, RegionFigure[]> {
  const out = new Map<string, RegionFigure[]>();
  for (const sourceRelativePath of new Set(sourceRelativePaths)) {
    const paper = loadLocalPaper(sourceRelativePath);
    out.set(
      sourceRelativePath,
      (paper?.figures ?? []).map((figure) => ({
        label: figure.label,
        pageNumber: figure.page_number,
        yTop: figure.y_top,
        yBottom: figure.y_bottom,
      })),
    );
  }
  return out;
}

export function getLocalPageLayoutsBySource(sourceRelativePaths: string[]): Map<string, RegionPageLayout[]> {
  const out = new Map<string, RegionPageLayout[]>();
  for (const sourceRelativePath of new Set(sourceRelativePaths)) {
    const paper = loadLocalPaper(sourceRelativePath);
    out.set(
      sourceRelativePath,
      (paper?.page_layouts ?? []).map((layout) => ({
        pageNumber: layout.page_number,
        pageWidth: layout.page_width,
        pageHeight: layout.page_height,
        contentX0: layout.content_x0,
        contentX1: layout.content_x1,
        headerFloorY: layout.header_floor_y,
        footerCeilingY: layout.footer_ceiling_y,
      })),
    );
  }
  return out;
}
