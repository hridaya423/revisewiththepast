import { PDFDocument, StandardFonts, rgb, type PDFPage } from "pdf-lib";

import { toPdfCropBox } from "../../domain/crop-geometry";
import { GENERATED_PAGE, type PlacedQuestionBlock, type PlacedFragment } from "../../domain/generated-layout";
import type { PreparedFragmentSource } from "./question-fragments";
import { addGeneratedContentPages, drawGeneratedAnswerSpacePage, setGeneratedPageRole } from "./page-chrome";

/** The painter only needs the page to embed, so typeset (non-source) fragments can be painted too. */
export type PaintableFragmentSource = Pick<PreparedFragmentSource, "fragmentId" | "sourcePdfPage">;

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

function validateBlock(block: PlacedQuestionBlock, sources: ReadonlyMap<string, PaintableFragmentSource>, fragmentIds: Set<string>) {
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
    const sourceFragmentId = fragment.sourceFragmentId ?? fragment.fragmentId;
    const source = sources.get(sourceFragmentId);
    if (!source) {
      throw new Error(`Missing prepared source for fragment ${fragment.fragmentId}.`);
    }
    if (source.fragmentId !== sourceFragmentId) {
      throw new Error(`Prepared source fragment ID does not match fragment ${fragment.fragmentId}.`);
    }
  }
}

export type PaintGeneratedLayoutOptions = {
  totalMarks?: number;
  endLabel?: string;
  showPaperTotal?: boolean;
};

function drawBoxedMarker(
  page: PDFPage,
  markerFont: import("pdf-lib").PDFFont,
  ink: ReturnType<typeof rgb>,
  stripLeft: number,
  stripRight: number,
  stripBottom: number,
  stripHeight: number,
  text: string,
) {
  const chars = text.split("");
  const digitCount = chars.filter((char) => /\d/.test(char)).length;
  const dotCount = chars.filter((char) => char === ".").length;
  const letterCount = chars.filter((char) => /[a-z]/i.test(char)).length;
  if (digitCount === 0) return;
  const boxHeight = Math.min(stripHeight - 1, stripHeight * 0.9);
  const boxBottom = stripBottom + (stripHeight - boxHeight) / 2;
  const markerSize = boxHeight * 0.62;
  const capHeight = markerSize * 0.72;
  const baseline = boxBottom + (boxHeight - capHeight) / 2;
  const cellGap = 1;
  const dotGap = dotCount > 0 ? Math.max(5, boxHeight * 0.5) : 0;
  const letterGap = letterCount > 0 ? Math.max(6, boxHeight * 0.55) : 0;
  const fitWidth = (stripRight - stripLeft - (digitCount - 1) * cellGap - dotCount * dotGap - letterCount * letterGap) / digitCount;
  const cellWidth = Math.max(8, Math.min(boxHeight, fitWidth));
  let cursor = stripLeft;
  for (const char of chars) {
    if (char === ".") {
      const dotWidth = markerFont.widthOfTextAtSize(".", markerSize);
      page.drawText(".", {
        x: cursor + (dotGap - dotWidth) / 2,
        y: boxBottom + boxHeight * 0.3,
        size: markerSize,
        font: markerFont,
        color: ink,
      });
      cursor += dotGap;
      continue;
    }
    if (/\d/.test(char)) {
      page.drawRectangle({ x: cursor, y: boxBottom, width: cellWidth, height: boxHeight, borderColor: ink, borderWidth: 0.7 });
      const charWidth = markerFont.widthOfTextAtSize(char, markerSize);
      page.drawText(char, { x: cursor + (cellWidth - charWidth) / 2, y: baseline, size: markerSize, font: markerFont, color: ink });
      cursor += cellWidth + cellGap;
      continue;
    }
    if (!/[a-z]/i.test(char)) continue;
    const charWidth = markerFont.widthOfTextAtSize(char, markerSize);
    page.drawText(char, { x: cursor + (letterGap - charWidth) / 2, y: baseline, size: markerSize, font: markerFont, color: ink });
    cursor += letterGap;
  }
}

export async function paintGeneratedLayout(
  outputDoc: PDFDocument,
  blocks: PlacedQuestionBlock[],
  sources: ReadonlyMap<string, PaintableFragmentSource>,
  options: PaintGeneratedLayoutOptions = {},
): Promise<PDFPage[]> {
  const fragmentIds = new Set<string>();
  for (const block of blocks) {
    validateBlock(block, sources, fragmentIds);
  }

  const totalContentPages = maxOutputPageIndex(blocks) + 1;
  const pages = addGeneratedContentPages(outputDoc, totalContentPages);
  const numberFont = await outputDoc.embedFont(StandardFonts.TimesRomanBold);
  const markerFont = await outputDoc.embedFont(StandardFonts.HelveticaBold);
  const footerFont = await outputDoc.embedFont(StandardFonts.TimesRoman);
  const furnitureFont = await outputDoc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.1, 0.1, 0.1);
  const pageContentBottom = new Array<number>(totalContentPages).fill(Number.POSITIVE_INFINITY);

  for (const block of blocks) {
    const drawsMarkers = block.fragments.some((fragment) => fragment.markers?.some((marker) => marker.text));
    const numberPage = pages[block.numberSlot.outputPageIndex];
    if (!numberPage) throw new Error(`Missing generated page ${block.numberSlot.outputPageIndex}.`);
    if (!drawsMarkers) {
      numberPage.drawText(String(block.number), {
        x: block.numberSlot.x,
        y: block.numberSlot.baseline,
        size: GENERATED_PAGE.numberFontSize,
        font: numberFont,
      });
    }

    if (block.footer) {
      const footerPage = pages[block.footer.outputPageIndex];
      if (!footerPage) throw new Error(`Missing generated footer page ${block.footer.outputPageIndex}.`);
      const footerWidth = footerFont.widthOfTextAtSize(block.footer.text, block.footer.fontSize);
      footerPage.drawText(block.footer.text, {
        x: GENERATED_PAGE.contentRight - footerWidth,
        y: block.footer.y,
        size: block.footer.fontSize,
        font: footerFont,
        color: ink,
      });
      pageContentBottom[block.footer.outputPageIndex] = Math.min(
        pageContentBottom[block.footer.outputPageIndex]!,
        block.footer.y,
      );
    }

    if (block.afterPage) {
      const answerPage = pages[block.afterPage.outputPageIndex];
      if (!answerPage) throw new Error(`Missing generated answer page ${block.afterPage.outputPageIndex}.`);
      setGeneratedPageRole(answerPage, "answer-space");
      drawGeneratedAnswerSpacePage(outputDoc, block.number, block.afterPage.marks, answerPage);
    }

    for (const fragment of block.fragments) {
      const page = pages[fragment.outputPageIndex];
      const source = sources.get(fragment.sourceFragmentId ?? fragment.fragmentId);
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
      if (process.env.PAPER_LAYOUT_DEBUG) {
        console.error(`FRAG page=${fragment.outputPageIndex + 1} id=${fragment.fragmentId} src=${fragment.sourceFragmentId ?? ""} x=${fragment.x.toFixed(0)} y=${fragment.y.toFixed(0)} w=${(fragment.width * fragment.scale).toFixed(0)} h=${(fragment.height * fragment.scale).toFixed(0)} crop=[${fragment.crop.left.toFixed(0)},${fragment.crop.bottom.toFixed(0)},${fragment.crop.right.toFixed(0)},${fragment.crop.top.toFixed(0)}] scale=${fragment.scale.toFixed(2)}`);
      }
      pageContentBottom[fragment.outputPageIndex] = Math.min(pageContentBottom[fragment.outputPageIndex]!, fragment.y);

      for (const marker of fragment.markers ?? []) {
        if (!marker.text) continue;
        const scale = fragment.scale;
        const pad = GENERATED_PAGE.identityStripPad;
        // Inline part markers ((b)) sit right against their prompt — draw every
        // marker from the left margin column instead, and cap the strip at the
        // prompt's left edge so a wider redrawn marker can't overrun it.
        const stripLeft = Math.min(
          fragment.x + (marker.numberBounds.x0 - pad.x - fragment.crop.left) * scale,
          fragment.x + 2,
        );
        const rightCap = marker.promptBounds
          ? Math.min(marker.numberBounds.x1 + pad.x, marker.promptBounds.x0 - 1)
          : marker.numberBounds.x1 + pad.x;
        const stripRight = fragment.x + (Math.max(rightCap, marker.numberBounds.x0) - fragment.crop.left) * scale;
        const stripBottom = fragment.y + (marker.numberBounds.y0 - pad.y - fragment.crop.bottom) * scale;
        const stripHeight = (marker.numberBounds.y1 - marker.numberBounds.y0 + pad.y * 2) * scale;
        drawBoxedMarker(page, markerFont, ink, stripLeft, stripRight, stripBottom, stripHeight, marker.text);
      }

      for (const ref of fragment.crossRefs ?? []) {
        // Refs are collected across the whole source page; only those inside
        // this fragment's crop are drawn — an off-crop ref would paint a lone
        // digit into empty space (e.g. "(Total for Question N)" on a page edge).
        if (ref.bounds.x1 < fragment.crop.left
          || ref.bounds.x0 > fragment.crop.right
          || ref.bounds.y1 < fragment.crop.bottom
          || ref.bounds.y0 > fragment.crop.top) continue;
        // Unmapped references (the named question wasn't selected) still had
        // their digits masked — redraw the source number so no gap is left.
        const refNumber = ref.generatedNumber ?? ref.sourceNumber;
        const refX = fragment.x + (ref.bounds.x0 - fragment.crop.left) * fragment.scale;
        const refBaseline = fragment.y + (ref.baselineY - fragment.crop.bottom) * fragment.scale;
        const refSize = Math.max(7, ref.fontHeight * fragment.scale * 0.92);
        page.drawText(String(refNumber), {
          x: refX,
          y: refBaseline,
          size: refSize,
          font: footerFont,
          color: ink,
        });
      }
    }
  }

  const lastPageIndex = totalContentPages - 1;
  for (let index = 0; index < totalContentPages; index += 1) {
    const page = pages[index];
    if (!page) continue;
    const pageNumber = outputDoc.getPageCount() - totalContentPages + index + 1;
    const pageNumberText = String(pageNumber);
    const pageNumberWidth = footerFont.widthOfTextAtSize(pageNumberText, 9);
    page.drawText(pageNumberText, {
      x: GENERATED_PAGE.width / 2 - pageNumberWidth / 2,
      y: 14,
      size: 9,
      font: footerFont,
      color: rgb(0.3, 0.3, 0.3),
    });
    if (index === lastPageIndex) {
      const endLabel = options.endLabel ?? "END";
      const endWidth = furnitureFont.widthOfTextAtSize(endLabel, 10);
      page.drawText(endLabel, {
        x: GENERATED_PAGE.width / 2 - endWidth / 2,
        y: GENERATED_PAGE.bottom - 12,
        size: 10,
        font: furnitureFont,
        color: ink,
      });
      if (options.showPaperTotal && options.totalMarks !== undefined) {
        const totalText = `(Total for paper is ${options.totalMarks} ${options.totalMarks === 1 ? "mark" : "marks"})`;
        const totalWidth = furnitureFont.widthOfTextAtSize(totalText, 10);
        page.drawText(totalText, {
          x: GENERATED_PAGE.contentRight - totalWidth,
          y: GENERATED_PAGE.bottom + 8,
          size: 10,
          font: furnitureFont,
          color: ink,
        });
      }
      continue;
    }
    const contentBottom = pageContentBottom[index]!;
    if (Number.isFinite(contentBottom) && contentBottom - GENERATED_PAGE.bottom > 72) {
      const turnOver = "Turn over";
      const turnOverWidth = furnitureFont.widthOfTextAtSize(turnOver, 10);
      page.drawText(turnOver, {
        x: GENERATED_PAGE.contentRight - turnOverWidth,
        y: GENERATED_PAGE.bottom - 12,
        size: 10,
        font: furnitureFont,
        color: ink,
      });
    }
  }

  return pages;
}
