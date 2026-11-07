import { renderPdfToPngBuffers } from "@/features/papers/infrastructure/pdfjs-server";
import { PDFDocument } from "pdf-lib";

import type { QaArtifactValidation } from "./qa-paper-gate";

export function invalidQaPdfArtifact(byteLength: number): QaArtifactValidation {
  return {
    readable: false,
    byteLength,
    pageCount: 0,
    renderedPageCount: 0,
    pageSizes: [],
    metadata: { title: null, creator: null, producer: null },
  };
}

export async function inspectQaPdfArtifact(bytes: Uint8Array, scale: number) {
  if (bytes.byteLength === 0) return { artifact: invalidQaPdfArtifact(0), rendered: null };
  try {
    const [rendered, document] = await Promise.all([
      renderPdfToPngBuffers(bytes, scale),
      PDFDocument.load(bytes, { updateMetadata: false }),
    ]);
    return {
      artifact: {
        readable: true,
        byteLength: bytes.byteLength,
        pageCount: rendered.document.numPages,
        renderedPageCount: rendered.pages.length,
        pageSizes: document.getPages().map((page) => page.getSize()),
        metadata: {
          title: document.getTitle() ?? null,
          creator: document.getCreator() ?? null,
          producer: document.getProducer() ?? null,
        },
      } satisfies QaArtifactValidation,
      rendered,
    };
  } catch {
    return { artifact: invalidQaPdfArtifact(bytes.byteLength), rendered: null };
  }
}
