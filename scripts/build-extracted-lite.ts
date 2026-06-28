import { gzipSync } from "node:zlib";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const SOURCE_ROOT = resolve(process.cwd(), "data/extracted");
const OUTPUT_ROOT = resolve(process.cwd(), "data/extracted-lite");

type ExtractedPage = {
  page_number: number;
  page_text?: string;
  text_lines?: unknown[];
};

type ExtractedPaper = {
  source_file?: string;
  pages?: ExtractedPage[];
};

function findPaperJsonFiles(dir: string, found: string[]) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      findPaperJsonFiles(fullPath, found);
    } else if (entry === "paper.json") {
      found.push(fullPath);
    }
  }
}

function main() {
  const files: string[] = [];
  findPaperJsonFiles(SOURCE_ROOT, files);

  let written = 0;
  let sourceBytes = 0;
  let outputBytes = 0;

  for (const filePath of files) {
    const raw = readFileSync(filePath, "utf8");
    sourceBytes += Buffer.byteLength(raw);
    const paper = JSON.parse(raw) as ExtractedPaper;

    const lite = {
      source_file: paper.source_file,
      pages: (paper.pages ?? []).map((page) => ({
        page_number: page.page_number,
        page_text: page.page_text ?? "",
        text_lines: page.text_lines ?? [],
      })),
    };

    const gz = gzipSync(Buffer.from(JSON.stringify(lite)), { level: 9 });
    const outPath = join(OUTPUT_ROOT, relative(SOURCE_ROOT, filePath)) + ".gz";
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, gz);
    outputBytes += gz.length;
    written += 1;
  }

  console.log(`Wrote ${written} lite files`);
  console.log(`Source: ${(sourceBytes / 1048576).toFixed(1)} MB  ->  Lite (gz): ${(outputBytes / 1048576).toFixed(1)} MB`);
}

main();
