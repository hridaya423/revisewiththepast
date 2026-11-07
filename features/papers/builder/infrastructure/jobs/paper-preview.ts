import "server-only";

import { getPdfDocument, renderPdfPageToPng } from "@/features/papers/infrastructure/pdfjs-server";

export async function renderPaperPreview(pdfBytes: Uint8Array) {
  const document = await getPdfDocument(pdfBytes);
  try {
    const page = await document.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    // Leave a pixel for floating-point viewport rounding before canvas ceil.
    const scale = Math.min(799 / viewport.width, 1199 / viewport.height, 1.5);
    return await renderPdfPageToPng(document, 1, scale);
  } finally {
    await document.destroy();
  }
}
