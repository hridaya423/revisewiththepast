import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { createCanvas, loadImage, type Image } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";

import { getGeneratedPageRole } from "@/features/papers/builder/infrastructure/pdf/page-chrome";
import { renderPdfToPngBuffers } from "@/features/papers/infrastructure/pdfjs-server";
import type { QaPaperConfig } from "./qa-paper-matrix";
import { findReferencePaperPair, referenceDirectoryForConfig } from "./qa-paper-references";
import { blindPairMetadata, pairEveryGeneratedPage, type BlindArtifact, type BlindReviewKey, type BlindReviewPair } from "./qa-blind-review";

type CliOptions = {
  run: string | null;
  config: string | null;
  realScale: number;
};

const COLUMN_WIDTH = 920;
const GAP = 24;
const LABEL_HEIGHT = 30;
const SHEET_MARGIN = 28;
type RunReport = {
  reports: Array<Pick<QaPaperConfig, "configKey" | "subjectKey" | "subjectTier" | "paperCode"> & {
    paperIndex: number;
    ok: boolean;
  }>;
};

type Card = {
  img: Image;
  width: number;
  height: number;
};

type SheetRow = {
  label: string;
  left: Card | null;
  right: Card | null;
};

function usage(): never {
  console.error("Usage: tsx scripts/build-bar-sheets.ts --run <qa-run-dir> [--config <configKey>] [--scale <n>]");
  process.exit(1);
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = { run: null, config: null, realScale: 2 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      const value = argv[index];
      if (value === undefined) throw new Error(`Missing value for ${arg}`);
      return value;
    };
    if (arg === "--run") options.run = next();
    else if (arg === "--config") options.config = next();
    else if (arg === "--scale") options.realScale = Math.max(1, Math.min(4, Number.parseFloat(next()) || 2));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.run) usage();
  return options;
}

async function renderPdfPages(pdfPath: string, scale: number) {
  const rendered = await renderPdfToPngBuffers(new Uint8Array(readFileSync(pdfPath)), scale);
  return rendered.pages;
}

async function cardFromPng(png: Buffer): Promise<Card> {
  const img = await loadImage(png);
  const scale = COLUMN_WIDTH / img.width;
  return { img, width: COLUMN_WIDTH, height: Math.ceil(img.height * scale) };
}

function composeSheet(title: string, rows: SheetRow[]): Buffer {
  const usableRows = rows.filter((row) => row.left !== null || row.right !== null);
  if (usableRows.length === 0) throw new Error(`No usable rows for sheet "${title}".`);
  const width = SHEET_MARGIN * 2 + COLUMN_WIDTH * 2 + GAP;
  const height = SHEET_MARGIN * 2 + LABEL_HEIGHT + usableRows.length
    * (LABEL_HEIGHT + Math.max(...usableRows.map((row) => Math.max(row.left?.height ?? 0, row.right?.height ?? 0))) + GAP);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f4f4f5";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#111827";
  ctx.font = "bold 20px sans-serif";
  ctx.fillText(title, SHEET_MARGIN, SHEET_MARGIN + 20);

  let y = SHEET_MARGIN + LABEL_HEIGHT;
  for (const row of usableRows) {
    ctx.fillStyle = "#374151";
    ctx.font = "15px sans-serif";
    ctx.fillText(row.label, SHEET_MARGIN, y + 20);
    y += LABEL_HEIGHT;
    const rowHeight = Math.max(row.left?.height ?? 0, row.right?.height ?? 0);
    ctx.fillStyle = "#111827";
    ctx.font = "bold 16px sans-serif";
    if (row.left) {
      ctx.fillText("OURS", SHEET_MARGIN, y + 22);
      ctx.drawImage(row.left.img, SHEET_MARGIN, y, row.left.width, row.left.height);
    }
    if (row.right) {
      const x = SHEET_MARGIN + COLUMN_WIDTH + GAP;
      ctx.fillText("REAL", x, y + 22);
      ctx.drawImage(row.right.img, x, y, row.right.width, row.right.height);
    }
    y += rowHeight + GAP;
  }
  return canvas.toBuffer("image/png");
}

function blindSide(card: Card): Buffer {
  const canvas = createCanvas(card.width, card.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, card.width, card.height);
  ctx.drawImage(card.img, 0, 0, card.width, card.height);
  return canvas.toBuffer("image/png");
}

function writeBlindPair(input: {
  blindDir: string;
  pairId: string;
  artifact: BlindArtifact;
  generatedPage: number;
  referencePage: number;
  oursFirst: boolean;
  reviewMode: BlindReviewPair["reviewMode"];
  ours: Card;
  real: Card;
}) {
  writeFileSync(join(input.blindDir, `pair-${input.pairId}-A.png`), blindSide(input.oursFirst ? input.ours : input.real));
  writeFileSync(join(input.blindDir, `pair-${input.pairId}-B.png`), blindSide(input.oursFirst ? input.real : input.ours));
  return blindPairMetadata(input);
}

async function readGeneratedPageRoles(pdfPath: string): Promise<Array<"question-content" | "answer-space" | null>> {
  try {
    const document = await PDFDocument.load(readFileSync(pdfPath));
    return document.getPages().map(getGeneratedPageRole);
  } catch {
    return [];
  }
}

type PaperEntry = {
  configKey: string;
  paperIndex: number;
  sheets: string[];
  blindPairs: BlindReviewPair[];
  realQuestionPaper: string | null;
  realMarkScheme: string | null;
};

async function buildQuestionPaperSheet(
  paperDir: string,
  generatedPageFiles: string[],
  roles: Array<"question-content" | "answer-space" | null>,
  realQuestionPaper: string,
  realScale: number,
  outDir: string,
  blindDir: string,
  title: string,
  sheetName: string,
  paritySeed: number,
  blindCounter: () => number,
): Promise<{ sheet: string; blind: Array<{ review: BlindReviewPair; key: BlindReviewKey }> }> {
  const pageCount = generatedPageFiles.length;
  const realPages = await renderPdfPages(realQuestionPaper, realScale);
  const rows: SheetRow[] = [];
  for (const pair of pairEveryGeneratedPage(pageCount, realPages.length)) {
    const generatedIndex = pair.generatedPage - 1;
    const realPage = realPages[pair.referencePage - 1];
    const roleLabel = roles[generatedIndex] === "answer-space"
      ? "answer space"
      : generatedIndex === 0
        ? "cover"
        : "content";
    rows.push({
      label: `${roleLabel}: ours p${generatedIndex + 1} vs real p${realPage?.pageNumber ?? "?"}`,
      left: await cardFromPng(readFileSync(join(paperDir, generatedPageFiles[generatedIndex]))),
      right: realPage ? await cardFromPng(realPage.png) : null,
    });
  }

  const sheetPath = join(outDir, `${sheetName}-question-paper.png`);
  writeFileSync(sheetPath, composeSheet(title, rows));

  const blind = [];
  for (const pair of pairEveryGeneratedPage(generatedPageFiles.length, realPages.length)) {
    const generatedFile = generatedPageFiles[pair.generatedPage - 1];
    const realPage = realPages[pair.referencePage - 1];
    if (!generatedFile || !realPage) continue;
    const pairId = String(blindCounter()).padStart(4, "0");
    blind.push(writeBlindPair({
      blindDir,
      pairId,
      artifact: "question-paper",
      generatedPage: pair.generatedPage,
      referencePage: pair.referencePage,
      oursFirst: (paritySeed + pair.generatedPage) % 2 === 0,
      reviewMode: pair.generatedPage === 1 ? "visual" : "blind",
      ours: await cardFromPng(readFileSync(join(paperDir, generatedFile))),
      real: await cardFromPng(realPage.png),
    }));
  }
  return { sheet: basename(sheetPath), blind };
}

async function buildMarkSchemeSheet(
  paperDir: string,
  realMarkScheme: string,
  realScale: number,
  outDir: string,
  blindDir: string,
  title: string,
  sheetName: string,
  paritySeed: number,
  blindCounter: () => number,
): Promise<{ sheet: string; blind: Array<{ review: BlindReviewPair; key: BlindReviewKey }> }> {
  const oursMsPath = join(paperDir, "mark-scheme.pdf");
  const oursMs = await renderPdfPages(oursMsPath, realScale);
  const realMs = await renderPdfPages(realMarkScheme, realScale);
  const rows: SheetRow[] = [];
  for (const pair of pairEveryGeneratedPage(oursMs.length, realMs.length)) {
    const oursPage = oursMs[pair.generatedPage - 1];
    const realPage = realMs[pair.referencePage - 1];
    if (!oursPage || !realPage) continue;
    rows.push({
      label: `mark scheme: ours p${oursPage.pageNumber} vs real p${realPage.pageNumber}`,
      left: await cardFromPng(oursPage.png),
      right: await cardFromPng(realPage.png),
    });
  }

  const sheetPath = join(outDir, `${sheetName}-mark-scheme.png`);
  
  writeFileSync(sheetPath, composeSheet(title, rows));

  const blind = [];
  for (const pair of pairEveryGeneratedPage(oursMs.length, realMs.length)) {
    const oursPage = oursMs[pair.generatedPage - 1];
    const realPage = realMs[pair.referencePage - 1];
    if (!oursPage || !realPage) continue;
    const pairId = String(blindCounter()).padStart(4, "0");
    blind.push(writeBlindPair({
      blindDir,
      pairId,
      artifact: "mark-scheme",
      generatedPage: pair.generatedPage,
      referencePage: pair.referencePage,
      oursFirst: (paritySeed + pair.generatedPage) % 2 === 0,
      reviewMode: pair.generatedPage === 1 ? "visual" : "blind",
      ours: await cardFromPng(oursPage.png),
      real: await cardFromPng(realPage.png),
    }));
  }
  return { sheet: basename(sheetPath), blind };
}

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const runDir = resolve(process.cwd(), options.run!);
  const reportPath = join(runDir, "report.json");
  if (!existsSync(reportPath)) usage();
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as RunReport;

  const outDir = join(runDir, "bar-sheets");
  const blindDir = join(outDir, "blind");
  mkdirSync(blindDir, { recursive: true });

  const manifest: PaperEntry[] = [];
  const blindKeys: BlindReviewKey[] = [];
  let blindCount = 0;
  const nextBlind = () => {
    const value = blindCount;
    blindCount += 1;
    return value;
  };

  for (const paperReport of report.reports) {
    if (options.config && paperReport.configKey !== options.config) continue;
    const paperDir = join(runDir, paperReport.configKey, `paper-${paperReport.paperIndex + 1}`);
    if (!existsSync(paperDir)) continue;

    const paperNumber = paperReport.paperIndex + 1;
    const sheetName = `${paperReport.configKey}-p${paperNumber}`;
    const entry: PaperEntry = {
      configKey: paperReport.configKey,
      paperIndex: paperReport.paperIndex,
      sheets: [],
      blindPairs: [],
      realQuestionPaper: null,
      realMarkScheme: null,
    };

    const realDir = referenceDirectoryForConfig(paperReport);
    const referencePair = realDir && existsSync(realDir)
      ? findReferencePaperPair(readdirSync(realDir).filter((file) => file.endsWith(".pdf")), paperReport.paperCode)
      : null;
    const real = referencePair && realDir ? {
      questionPaper: join(realDir, referencePair.questionPaperFile),
      markScheme: join(realDir, referencePair.markSchemeFile),
    } : { questionPaper: null, markScheme: null };
    entry.realQuestionPaper = real.questionPaper;
    entry.realMarkScheme = real.markScheme;

    const generatedPageFiles = readdirSync(paperDir)
      .filter((file) => /^page-\d{2}\.png$/.test(file))
      .sort();
    const generatedPdfFile = readdirSync(paperDir)
      .find((file) => file.endsWith(".pdf") && file !== "mark-scheme.pdf");

    if (generatedPageFiles.length > 0 && real.questionPaper && generatedPdfFile) {
      const roles = await readGeneratedPageRoles(join(paperDir, generatedPdfFile));
      const result = await buildQuestionPaperSheet(
        paperDir,
        generatedPageFiles,
        roles,
        real.questionPaper,
        options.realScale,
        outDir,
        blindDir,
        `${paperReport.configKey} paper ${paperNumber} vs ${basename(real.questionPaper)}`,
        sheetName,
        paperNumber,
        nextBlind,
      );
      entry.sheets.push(result.sheet);
      entry.blindPairs.push(...result.blind.map((pair) => pair.review));
      blindKeys.push(...result.blind.map((pair) => pair.key));
    }

    if (real.markScheme && existsSync(join(paperDir, "mark-scheme.pdf"))) {
      const result = await buildMarkSchemeSheet(
        paperDir,
        real.markScheme,
        options.realScale,
        outDir,
        blindDir,
        `${paperReport.configKey} paper ${paperNumber} mark schemes`,
        sheetName,
        paperNumber + 1,
        nextBlind,
      );
      entry.sheets.push(result.sheet);
      entry.blindPairs.push(...result.blind.map((pair) => pair.review));
      blindKeys.push(...result.blind.map((pair) => pair.key));
    }

    manifest.push(entry);
    console.log(`sheets built: ${paperReport.configKey} paper ${paperNumber}`);
  }

  writeFileSync(
    join(outDir, "manifest.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), entries: manifest }, null, 2),
  );
  writeFileSync(
    join(blindDir, "manifest.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), entries: manifest.map(({ configKey, paperIndex, blindPairs }) => ({ configKey, paperIndex, blindPairs })) }, null, 2),
  );
  writeFileSync(join(outDir, "blind-key.json"), JSON.stringify({ pairs: blindKeys }, null, 2));
  console.log(`done: ${join(outDir, "manifest.json")} (${blindCount} blind pairs)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
