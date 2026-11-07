import { PDFDocument, type PDFPage } from "pdf-lib";

import { GENERATED_PAGE, planGeneratedQuestions } from "@/features/papers/builder/domain/generated-layout";
import { paintGeneratedLayout, type PaintableFragmentSource } from "@/features/papers/builder/infrastructure/pdf/paint-generated-layout";
import type { ShadowArtifactKind } from "../../contracts/shadow-paper";
import type { ShadowPaperVariant } from "../../domain/types";
import { drawShadowPaperCover, drawShadowSchemeCover, stampShadowPage } from "./cover";
import { embedShadowFonts } from "./fonts";
import { MATH_RENDERER_VERSION } from "./math-renderer";
import { questionColumn, schemeColumn, typesetFragment, type TypesetFragment } from "./question-fragments";

export const SHADOW_RENDERER_VERSION = `shadow-pdf-v1+${MATH_RENDERER_VERSION}`;

export class ShadowRenderError extends Error {
  constructor(message: string, readonly unitKey?: string) {
    super(message);
    this.name = "ShadowRenderError";
  }
}

export type RenderedShadowArtifact = {
  kind: ShadowArtifactKind;
  bytes: Uint8Array;
  pageCount: number;
};

export type ShadowRenderOptions = {
  /** Fixed into the PDF metadata so the same variant always produces the same bytes. */
  createdAt?: Date;
};

async function paintColumns(kind: ShadowArtifactKind, variant: ShadowPaperVariant, options: ShadowRenderOptions): Promise<RenderedShadowArtifact> {
  const doc = await PDFDocument.create();
  const scratch = await PDFDocument.create();
  const [fonts, scratchFonts] = await Promise.all([embedShadowFonts(doc), embedShadowFonts(scratch)]);
  const source = variant.manifest.source;
  const coverModel = { source, displayCode: variant.displayCode, questionCount: variant.units.length };
  if (kind === "paper") drawShadowPaperCover(doc, fonts, coverModel);
  else drawShadowSchemeCover(doc, fonts, coverModel);

  const typeset: TypesetFragment[] = variant.units.map((unit, index) => {
    const column = kind === "paper" ? questionColumn(unit.question, scratchFonts) : schemeColumn(unit.question, unit.solution, scratchFonts);
    try {
      return typesetFragment({
        scratch,
        fonts: scratchFonts,
        column,
        fragmentId: `${kind}:${unit.displayOrder}`,
        unitKey: unit.sourceUnitKey,
        sourcePageNumber: index + 1,
      });
    } catch (error) {
      throw new ShadowRenderError(`Question ${unit.displayOrder}: ${(error as Error).message}`, unit.sourceUnitKey);
    }
  });

  // Standard fonts write their dictionaries lazily; flush so embedded fragment pages reference real font objects.
  await scratch.flush();

  const plan = planGeneratedQuestions({
    questions: variant.units.map((unit, index) => ({
      unitKey: unit.sourceUnitKey,
      number: unit.question.number,
      fragments: [typeset[index]!.fragment],
    })),
  });
  if (plan.kind !== "success") throw new ShadowRenderError(`The page planner could not place ${plan.unitKey}: ${plan.reason}.`, plan.unitKey);
  for (const block of plan.blocks) {
    for (const fragment of block.fragments) {
      if (Math.abs(fragment.scale - 1) > 1e-9) throw new ShadowRenderError(`Question ${block.number} would print at ${(fragment.scale * 100).toFixed(0)}% scale.`, block.unitKey);
      if (fragment.y < GENERATED_PAGE.bottom - 0.5 || fragment.y + fragment.height > GENERATED_PAGE.height - GENERATED_PAGE.top + 0.5) {
        throw new ShadowRenderError(`Question ${block.number} does not fit on a page.`, block.unitKey);
      }
    }
  }

  const sources = new Map<string, PaintableFragmentSource>(typeset.map(({ fragment, page }) => [fragment.fragmentId, { fragmentId: fragment.fragmentId, sourcePdfPage: page }]));
  const contentPages: PDFPage[] = await paintGeneratedLayout(doc, plan.blocks, sources, {
    totalMarks: variant.totalMarks,
    showPaperTotal: kind === "paper",
    endLabel: kind === "paper" ? "END OF SHADOW PAPER" : "END OF MARK SCHEME",
  });
  for (const page of contentPages) stampShadowPage(page, fonts, { kind, displayCode: variant.displayCode, source });

  applyMetadata(doc, kind, variant, options);
  const bytes = await doc.save({ useObjectStreams: true });
  return { kind, bytes, pageCount: doc.getPageCount() };
}

function applyMetadata(doc: PDFDocument, kind: ShadowArtifactKind, variant: ShadowPaperVariant, options: ShadowRenderOptions) {
  const source = variant.manifest.source;
  const title = `${kind === "paper" ? "Shadow paper" : "Shadow mark scheme"} ${variant.displayCode}`;
  const createdAt = options.createdAt ?? new Date(0);
  doc.setTitle(title);
  doc.setSubject(`Shadow of ${source.boardLabel} ${source.specCode}/${source.componentCode} ${source.session} ${source.year} ${source.paperCode}`);
  doc.setKeywords(["gcsemeta-shadow", `variant:${variant.displayCode}`, `kind:${kind}`, `source:${source.sourcePaperId}`, `manifest:${variant.manifest.revision}`]);
  doc.setProducer(SHADOW_RENDERER_VERSION);
  doc.setCreator("Revise with the Past");
  doc.setAuthor("Revise with the Past");
  doc.setCreationDate(createdAt);
  doc.setModificationDate(createdAt);
}

export const renderShadowPaperPdf = (variant: ShadowPaperVariant, options: ShadowRenderOptions = {}) => paintColumns("paper", variant, options);
export const renderShadowSchemePdf = (variant: ShadowPaperVariant, options: ShadowRenderOptions = {}) => paintColumns("mark-scheme", variant, options);
