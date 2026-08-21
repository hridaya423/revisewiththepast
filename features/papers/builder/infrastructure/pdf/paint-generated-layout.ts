import { PDFDocument, StandardFonts, type PDFPage } from "pdf-lib";

import { toPdfCropBox } from "../../domain/crop-geometry";
import { GENERATED_PAGE, type PlacedQuestionBlock, type PlacedFragment } from "../../domain/generated-layout";
import type { PreparedFragmentSource } from "./question-fragments";
import { addGeneratedContentPages, drawGeneratedAnswerSpacePage, setGeneratedPageRole } from "./page-chrome";

function validateCrop(fragment: PlacedFragment, sourcePage: PDFPage) {
  const visiblePage = sourcePage.getCropBox();
  const crop = fragment.crop;
  if (!Number.isFinite(crop.left)
    || !Number.isFinite(crop.right)
    || !Number.isFinite(crop.bottom)
    || !Number.isFinite(crop.top)
    || crop.left < 0
    || crop.bottom < 0
    || crop.right <= crop.left
    || crop.top <= crop.bottom
    || crop.right > visiblePage.width
    || crop.top > visiblePage.height) {
    throw new Error(`Fragment ${fragment.fragmentId} crop is outside the visible source page.`);
  }
  return toPdfCropBox(crop, {
    x: visiblePage.x,
    y: visiblePage.y,
    width: visiblePage.width,
    height: visiblePage.height,
  });
}

function maxOutputPageIndex(blocks: PlacedQuestionBlock[]) {
  return Math.max(
    -1,
    ...blocks.flatMap((block) => [
      block.numberSlot.outputPageIndex,
      ...(block.afterPage ? [block.afterPage.outputPageIndex] : []),
      ...(block.footer ? [block.footer.outputPageIndex] : []),
      ...block.fragments.map((fragment) => fragment.outputPageIndex),
    ]),
  );
}

function validateBlock(block: PlacedQuestionBlock, sources: Map<string, PreparedFragmentSource>, fragmentIds: Set<string>) {
  if (!Number.isFinite(block.number) || !Number.isInteger(block.number) || block.number <= 0) {
    throw new Error(`Invalid question number ${block.number}.`);
  }
  if (!Number.isFinite(block.numberSlot.x) || !Number.isFinite(block.numberSlot.baseline)) {
    throw new Error(`Invalid number slot for question ${block.number}.`);
  }
  if (!Number.isInteger(block.numberSlot.outputPageIndex) || block.numberSlot.outputPageIndex < 0) {
    throw new Error(`Invalid output page index ${block.numberSlot.outputPageIndex} for question ${block.number}.`);
  }
  if (block.numberSlot.fontSize !== GENERATED_PAGE.numberFontSize) {
    throw new Error(`Question ${block.number} uses an invalid generated number font size.`);
  }
  for (const fragment of block.fragments) {
    if (fragmentIds.has(fragment.fragmentId)) {
      throw new Error(`Duplicate fragment ID ${fragment.fragmentId}.`);
    }
    fragmentIds.add(fragment.fragmentId);
    if (!Number.isInteger(fragment.outputPageIndex) || fragment.outputPageIndex < 0) {
      throw new Error(`Invalid output page index ${fragment.outputPageIndex} for fragment ${fragment.fragmentId}.`);
    }
    if (![fragment.x, fragment.y, fragment.width, fragment.height].every(Number.isFinite)
      || fragment.x < 0
      || fragment.y < 0
      || fragment.width < 0
      || fragment.height < 0) {
      throw new Error(`Invalid fragment geometry for ${fragment.fragmentId}.`);
    }
    if (!Number.isFinite(fragment.scale) || fragment.scale <= 0) {
      throw new Error(`Invalid scale ${fragment.scale} for fragment ${fragment.fragmentId}.`);
    }
    const source = sources.get(fragment.fragmentId);
    if (!source) {
      throw new Error(`Missing prepared source for fragment ${fragment.fragmentId}.`);
    }
    if (source.fragmentId !== fragment.fragmentId) {
      throw new Error(`Prepared source fragment ID does not match fragment ${fragment.fragmentId}.`);
    }
  }
}

export async function paintGeneratedLayout(
  outputDoc: PDFDocument,
  blocks: PlacedQuestionBlock[],
  sources: Map<string, PreparedFragmentSource>,
): Promise<PDFPage[]> {
  const fragmentIds = new Set<string>();
  for (const block of blocks) {
    validateBlock(block, sources, fragmentIds);
  }

  const pages = addGeneratedContentPages(outputDoc, maxOutputPageIndex(blocks) + 1);
  const numberFont = await outputDoc.embedFont(StandardFonts.TimesRomanBold);

  for (const block of blocks) {
    const numberPage = pages[block.numberSlot.outputPageIndex];
    if (!numberPage) throw new Error(`Missing generated page ${block.numberSlot.outputPageIndex}.`);
    numberPage.drawText(String(block.number), {
      x: block.numberSlot.x,
      y: block.numberSlot.baseline,
      size: GENERATED_PAGE.numberFontSize,
      font: numberFont,
    });

    if (block.footer) {
      const footerPage = pages[block.footer.outputPageIndex];
      if (!footerPage) throw new Error(`Missing generated footer page ${block.footer.outputPageIndex}.`);
      const footerFont = await outputDoc.embedFont(StandardFonts.TimesRoman);
      footerPage.drawText(block.footer.text, {
        x: block.footer.x,
        y: block.footer.y,
        size: block.footer.fontSize,
        font: footerFont,
      });
    }

    if (block.afterPage) {
      const answerPage = pages[block.afterPage.outputPageIndex];
      if (!answerPage) throw new Error(`Missing generated answer page ${block.afterPage.outputPageIndex}.`);
      setGeneratedPageRole(answerPage, "answer-space");
      drawGeneratedAnswerSpacePage(outputDoc, block.number, block.afterPage.marks, answerPage);
    }

    for (const fragment of block.fragments) {
      const page = pages[fragment.outputPageIndex];
      const source = sources.get(fragment.fragmentId);
      if (!page || !source) throw new Error(`Missing prepared source for fragment ${fragment.fragmentId}.`);
      const cropBox = validateCrop(fragment, source.sourcePdfPage);
      const embeddedPage = await outputDoc.embedPage(source.sourcePdfPage, cropBox);
      await embeddedPage.embed();
      page.drawPage(embeddedPage, {
        x: fragment.x,
        y: fragment.y,
        width: fragment.width * fragment.scale,
        height: fragment.height * fragment.scale,
      });
    }
  }

  return pages;
}
