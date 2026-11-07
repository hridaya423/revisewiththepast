import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import { renderPdfToPngBuffers } from "@/features/papers/infrastructure/pdfjs-server";

function usage(): never {
  console.error("Usage: tsx scripts/render-pdf-pages.ts <pdf-path> <out-dir> [scale]");
  process.exit(1);
}

async function main() {
  const [pdfPath, outDir, scaleArg] = process.argv.slice(2);
  if (!pdfPath || !outDir) usage();
  const scale = Math.max(0.5, Math.min(4, Number.parseFloat(scaleArg ?? "1.5") || 1.5));
  const rendered = await renderPdfToPngBuffers(new Uint8Array(readFileSync(pdfPath)), scale);
  mkdirSync(outDir, { recursive: true });
  for (const page of rendered.pages) {
    writeFileSync(resolve(outDir, `${basename(pdfPath, ".pdf")}-${String(page.pageNumber).padStart(2, "0")}.png`), page.png);
  }
  console.log(`${rendered.pages.length} pages -> ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
