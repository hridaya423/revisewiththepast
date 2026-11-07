import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { inspectQaPdfArtifact } from "./qa-pdf-artifact";

describe("QA PDF artifact inspection", () => {
  it("reads page dimensions and document metadata from a real PDF", async () => {
    const document = await PDFDocument.create({ updateMetadata: false });
    document.addPage([595.28, 841.89]);
    document.addPage([841.89, 595.28]);
    document.setTitle("GCSE Mathematics");
    document.setCreator("Pearson");
    document.setProducer("Adobe PDF Library");

    const result = await inspectQaPdfArtifact(await document.save(), 1);

    expect(result.artifact).toMatchObject({
      readable: true,
      pageCount: 2,
      renderedPageCount: 2,
      pageSizes: [
        { width: 595.28, height: 841.89 },
        { width: 841.89, height: 595.28 },
      ],
      metadata: {
        title: "GCSE Mathematics",
        creator: "Pearson",
        producer: "Adobe PDF Library",
      },
    });
    expect(result.rendered?.pages).toHaveLength(2);
  });

  it("returns an unreadable artifact for invalid bytes", async () => {
    const result = await inspectQaPdfArtifact(new Uint8Array([1, 2, 3]), 1);

    expect(result).toEqual({
      artifact: {
        readable: false,
        byteLength: 3,
        pageCount: 0,
        renderedPageCount: 0,
        pageSizes: [],
        metadata: { title: null, creator: null, producer: null },
      },
      rendered: null,
    });
  });
});
