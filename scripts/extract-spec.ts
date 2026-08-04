import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pdfPath = process.argv[2];
const outPath = process.argv[3];

if (!pdfPath || !outPath) {
  console.error('Usage: tsx extract-spec.ts <input.pdf> <output.txt>');
  process.exit(1);
}

async function main() {
  const buffer = readFileSync(pdfPath);
  const pdf = await getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    standardFontDataUrl: resolve('node_modules/pdfjs-dist/standard_fonts') + '/'
  }).promise;

  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
     const text = content.items
       .map((item) => ("str" in item && typeof item.str === "string" ? item.str : ""))
       .join(" ");
    fullText += `--- PAGE ${i} ---\n${text}\n\n`;
  }
  writeFileSync(outPath, fullText);
  console.log('Extracted', pdf.numPages, 'pages,', fullText.length, 'chars');
}

main().catch(e => console.error(e));
