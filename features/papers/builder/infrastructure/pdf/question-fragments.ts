import type { PDFDocument, PDFPage } from "pdf-lib";

import type { PreparedQuestionFragment, SourcePageCrop } from "../../domain/generated-layout";
import { buildUnitRenderPlan, type RegionFigure, type RegionPageLayout } from "../../domain/region-render";
import type { QuestionUnit, SourcePageAsset } from "@/shared/domain/paper";
import { rasterizeSourcePdfPage, type SourcePdfCandidate } from "./source-pdf";

export type PreparedFragmentSource = {
  fragmentId: string;
  candidate: SourcePdfCandidate;
  sourceDoc: PDFDocument;
  sourcePdfPage: PDFPage;
};

export type QuestionFragmentPreparation =
  | {
      kind: "success";
      fragments: [PreparedQuestionFragment, ...PreparedQuestionFragment[]];
      sources: Map<string, PreparedFragmentSource>;
    }
  | {
      kind: "unrenderable";
      unitKey: string;
      page: number;
      reason: QuestionFragmentUnrenderableReason;
    };

export type QuestionFragmentUnrenderableReason =
  | "missing-anchor"
  | "anchor-page-mismatch"
  | "anchor-out-of-crop"
  | "missing-source-asset"
  | "missing-page-layout"
  | "source-unavailable"
  | "ambiguous-anchor";

type PreparationInput = {
  unit: QuestionUnit;
  allUnits: QuestionUnit[];
  pageAssetsBySource: Map<string, SourcePageAsset[]>;
  figures: RegionFigure[];
  pageLayouts: RegionPageLayout[];
};

type SourceCache = {
  bytes: Map<string, Uint8Array>;
  documents: Map<string, PDFDocument>;
};

function cropFromRegion(crop: { left: number; right: number; bottom: number; top: number }): SourcePageCrop {
  return { left: crop.left, right: crop.right, bottom: crop.bottom, top: crop.top };
}

function hasValidBounds(bounds: { x0: number; x1: number; y0: number; y1: number }) {
  return Number.isFinite(bounds.x0)
    && Number.isFinite(bounds.x1)
    && Number.isFinite(bounds.y0)
    && Number.isFinite(bounds.y1)
    && bounds.x0 <= bounds.x1
    && bounds.y0 <= bounds.y1;
}

function contains(crop: SourcePageCrop, bounds: { x0: number; x1: number; y0: number; y1: number }) {
  return bounds.x0 >= crop.left
    && bounds.x1 <= crop.right
    && bounds.y0 >= crop.bottom
    && bounds.y1 <= crop.top;
}

function sourceUrlForPage(unit: QuestionUnit, page: number, assets: Map<string, SourcePageAsset[]>) {
  const asset = (assets.get(unit.sourceRelativePath) ?? []).find((entry) => entry.pageNumber === page);
  if (asset?.cdnUrl) return { url: asset.cdnUrl, sourcePageIndex: 0 };
  if (asset?.relativePath) return { url: asset.relativePath, sourcePageIndex: 0 };
  const embeddedPage = unit.parts
    .flatMap((part) => part.pageAssetCdnUrls)
    .find((entry) => entry.pageNumber === page && entry.cdnUrl);
  if (embeddedPage?.cdnUrl) return { url: embeddedPage.cdnUrl, sourcePageIndex: 0 };
  if (unit.questionPaperCdnUrl) return { url: unit.questionPaperCdnUrl, sourcePageIndex: Math.max(0, page - 1) };
  return null;
}

function ordinaryCrops(unit: QuestionUnit, pageLayouts: Map<number, RegionPageLayout>) {
  return unit.pages.map((page) => {
    const geometry = pageLayouts.get(page.pageNumber);
    const bounds = page.bboxUnion ?? (geometry ? {
      x0: geometry.contentX0,
      x1: geometry.contentX1,
      y0: geometry.footerCeilingY,
      y1: geometry.headerFloorY,
    } : null);
    return {
      pageNumber: page.pageNumber,
      cropBox: bounds
        ? { left: bounds.x0, right: bounds.x1, bottom: bounds.y0, top: bounds.y1 }
        : { left: 0, right: 595.28, bottom: 0, top: 841.89 },
      kind: page.pageNumber === unit.pages[0]?.pageNumber ? "question" as const : "continuation" as const,
    };
  });
}

export async function prepareQuestionFragments(input: PreparationInput): Promise<QuestionFragmentPreparation> {
  const layoutByPage = new Map(input.pageLayouts.map((layout) => [layout.pageNumber, layout]));
  const requiredPages = new Set(
    input.unit.parts.flatMap((part) => [
      ...(part.regionSpans ?? []).map((span) => span.pageNumber),
      ...(part.stemSpans ?? []).map((span) => span.pageNumber),
    ]),
  );
  for (const page of Array.from(requiredPages).sort((a, b) => a - b)) {
    if (!layoutByPage.has(page)) {
      return { kind: "unrenderable", unitKey: input.unit.unitKey, page, reason: "missing-page-layout" };
    }
  }

  const plannedCrops = buildUnitRenderPlan(input.unit, layoutByPage, input.figures);
  const effectiveCrops = plannedCrops.length > 0 ? plannedCrops : ordinaryCrops(input.unit, layoutByPage);
  if (effectiveCrops.length === 0) {
    const page = input.unit.parts[0]?.pageNumber ?? input.unit.pages[0]?.pageNumber ?? 1;
    return { kind: "unrenderable", unitKey: input.unit.unitKey, page, reason: "missing-page-layout" };
  }

  const firstQuestionIndex = effectiveCrops.findIndex((crop) => crop.kind === "question");
  if (firstQuestionIndex < 0) {
    return { kind: "unrenderable", unitKey: input.unit.unitKey, page: input.unit.parts[0]?.pageNumber ?? 1, reason: "missing-anchor" };
  }

  const firstQuestionPage = effectiveCrops[firstQuestionIndex].pageNumber;
  const persistedAnchors = input.unit.parts
    .map((part) => part.identityAnchor)
    .filter((anchor): anchor is NonNullable<typeof anchor> => anchor !== undefined && anchor !== null);
  const uniqueAnchors = Array.from(
    new Map(persistedAnchors.map((anchor) => [
      [
        anchor.pageNumber,
        anchor.numberBounds.x0,
        anchor.numberBounds.x1,
        anchor.numberBounds.y0,
        anchor.numberBounds.y1,
        anchor.promptBaseline,
        anchor.promptBounds.x0,
        anchor.promptBounds.x1,
        anchor.promptBounds.y0,
        anchor.promptBounds.y1,
      ].join(":"),
      anchor,
    ])).values(),
  );
  const firstPageAnchors = uniqueAnchors.filter((anchor) => anchor.pageNumber === firstQuestionPage);
  if (firstPageAnchors.length > 1) {
    return { kind: "unrenderable", unitKey: input.unit.unitKey, page: firstQuestionPage, reason: "ambiguous-anchor" };
  }
  const firstAnchor = firstPageAnchors[0] ?? null;
  if (firstAnchor === null) {
    return {
      kind: "unrenderable",
      unitKey: input.unit.unitKey,
      page: firstQuestionPage,
      reason: uniqueAnchors.length > 0 ? "anchor-page-mismatch" : "missing-anchor",
    };
  }
  if (!hasValidBounds(firstAnchor.numberBounds) || !hasValidBounds(firstAnchor.promptBounds)) {
    return { kind: "unrenderable", unitKey: input.unit.unitKey, page: firstQuestionPage, reason: "ambiguous-anchor" };
  }
  const firstQuestionCrop = cropFromRegion(effectiveCrops[firstQuestionIndex].cropBox);
  const numberCropIndexes = effectiveCrops.flatMap((planned, index) => (
    planned.pageNumber === firstAnchor.pageNumber && contains(cropFromRegion(planned.cropBox), firstAnchor.numberBounds)
      ? [index]
      : []
  ));
  if (!contains(firstQuestionCrop, firstAnchor.promptBounds) || numberCropIndexes.length !== 1) {
    return { kind: "unrenderable", unitKey: input.unit.unitKey, page: firstQuestionPage, reason: "anchor-out-of-crop" };
  }
  const cache: SourceCache = { bytes: new Map(), documents: new Map() };
  const fragments: PreparedQuestionFragment[] = [];
  const sources = new Map<string, PreparedFragmentSource>();
  const anchoredPart = input.unit.parts.find((part) => part.identityAnchor === firstAnchor)
    ?? input.unit.parts.find((part) => part.identityAnchor?.pageNumber === firstAnchor.pageNumber
      && part.identityAnchor.numberBounds.x0 === firstAnchor.numberBounds.x0
      && part.identityAnchor.numberBounds.y0 === firstAnchor.numberBounds.y0);
  const shouldMaskAnchor = !/^[a-z]/i.test(anchoredPart?.questionPartNumber ?? "");
  let questionSeen = false;

  for (let index = 0; index < effectiveCrops.length; index += 1) {
    const planned = effectiveCrops[index];
    const crop = cropFromRegion(planned.cropBox);
    const isQuestion = planned.kind === "question";
    const identity = isQuestion && !questionSeen ? firstAnchor : null;
    if (isQuestion) questionSeen = true;

    const source = sourceUrlForPage(input.unit, planned.pageNumber, input.pageAssetsBySource);
    if (!source) {
      return { kind: "unrenderable", unitKey: input.unit.unitKey, page: planned.pageNumber, reason: "missing-source-asset" };
    }

    const fragmentId = `${input.unit.unitKey}:${planned.pageNumber}:${index}`;
    try {
      const raster = await rasterizeSourcePdfPage(source.url, source.sourcePageIndex, cache.bytes, cache.documents, {
        sanitizeFurniture: true,
        boardCode: input.unit.boardCode,
        sourceQuestionNumber: planned.pageNumber === firstAnchor.pageNumber ? input.unit.questionNumber : undefined,
        numberBounds: shouldMaskAnchor && planned.pageNumber === firstAnchor.pageNumber ? firstAnchor.numberBounds : undefined,
      });
      if (raster.isAdditionalAnswerPage) continue;
      if (planned.kind === "stem" && !raster.hasMeaningfulText) continue;
      const fragment = {
        fragmentId,
        unitKey: input.unit.unitKey,
        sourcePageNumber: planned.pageNumber,
        crop,
        identity,
        width: crop.right - crop.left,
        height: crop.top - crop.bottom,
        kind: index < firstQuestionIndex ? "support" : index === firstQuestionIndex ? "question" : "continuation",
      } satisfies PreparedQuestionFragment;
      fragments.push(fragment);
      sources.set(fragmentId, { fragmentId, candidate: raster.candidate, sourceDoc: raster.sourceDoc, sourcePdfPage: raster.sourcePdfPage });
    } catch {
      return { kind: "unrenderable", unitKey: input.unit.unitKey, page: planned.pageNumber, reason: "source-unavailable" };
    }
  }

  const [firstFragment, ...remainingFragments] = fragments;
  if (!firstFragment) {
    return { kind: "unrenderable", unitKey: input.unit.unitKey, page: firstQuestionPage, reason: "source-unavailable" };
  }
  return { kind: "success", fragments: [firstFragment, ...remainingFragments], sources };
}
