import { PDFDocument } from "pdf-lib";
import { loadImage } from "@napi-rs/canvas";
import { expect, it } from "vitest";

import { renderPaperPreview } from "./paper-preview";

it("renders a bounded image of the actual first PDF page", async () => {
  const document = await PDFDocument.create();
  document.addPage([595, 842]).drawText("Original practice paper preview");
  const bytes = await renderPaperPreview(await document.save());
  expect(Array.from(bytes.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const image = await loadImage(bytes);
  expect(image.width).toBeLessThanOrEqual(800);
  expect(image.height).toBeLessThanOrEqual(1200);
  expect(image.width / image.height).toBeCloseTo(595 / 842, 2);
});
