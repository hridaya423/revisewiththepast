import "server-only";

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { createCanvas, loadImage } from "@napi-rs/canvas";

import { renderPdfToPngBuffers } from "@/lib/marking/pdfjs-server";

type PaperReport = {
  configKey: string;
  paperIndex: number;
};

type QaReport = {
  reports: PaperReport[];
};

const PAGE_WIDTH = 360;
const GAP = 16;
const LABEL_HEIGHT = 28;

function usage(): never {
  console.error("Usage: tsx scripts/render-visual-review.ts <report.json> [...report.json]");
  process.exit(1);
}

async function renderPdfCard(path: string, pageIndex: number, label: string) {
  const rendered = await renderPdfToPngBuffers(new Uint8Array(readFileSync(path)), 0.7);
  const page = rendered.pages[pageIndex];
  if (!page) return null;
  const image = await loadImage(page.png);
  const scale = PAGE_WIDTH / image.width;
  const width = PAGE_WIDTH;
  const height = Math.ceil(image.height * scale);
  return { image, label, width, height };
}

async function renderPngCard(path: string, label: string) {
  const image = await loadImage(path);
  const scale = PAGE_WIDTH / image.width;
  return { image, label, width: PAGE_WIDTH, height: Math.ceil(image.height * scale) };
}

async function renderReview(reportPath: string) {
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as QaReport;
  const runDir = dirname(reportPath);
  const cards = [];

  for (const paper of report.reports) {
    const paperDir = resolve(runDir, paper.configKey, `paper-${paper.paperIndex + 1}`);
    const pdf = resolve(paperDir, "mark-scheme.pdf");
    const coverPng = resolve(paperDir, "page-01.png");
    const contentPng = resolve(paperDir, "page-02.png");

    if (existsSync(coverPng)) {
      cards.push(await renderPngCard(coverPng, `${paper.configKey} paper p1`));
    }
    if (existsSync(contentPng)) {
      cards.push(await renderPngCard(contentPng, `${paper.configKey} paper p2`));
    }

    if (existsSync(pdf)) {
      for (let pageIndex = 0; pageIndex < 4; pageIndex += 1) {
        const rendered = await renderPdfCard(pdf, pageIndex, `${paper.configKey} markscheme p${pageIndex + 1}`);
        if (rendered) cards.push(rendered);
      }
    }
  }

  const width = PAGE_WIDTH * 2 + GAP * 3;
  const rows = Math.ceil(cards.length / 2);
  const rowHeight = Math.max(...cards.map((card) => card.height)) + LABEL_HEIGHT;
  const height = GAP + rows * (rowHeight + GAP);
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");

  context.fillStyle = "#f4f4f5";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#111827";
  context.font = "16px sans-serif";

  cards.forEach((card, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = GAP + col * (PAGE_WIDTH + GAP);
    const y = GAP + row * (rowHeight + GAP);
    context.fillText(card.label, x, y + 18);
    context.drawImage(card.image, x, y + LABEL_HEIGHT, card.width, card.height);
  });

  writeFileSync(resolve(runDir, "visual-review.png"), canvas.toBuffer("image/png"));
  console.log(resolve(runDir, "visual-review.png"));
}

async function main() {
  const reportPaths = process.argv.slice(2);
  if (reportPaths.length === 0) usage();

  for (const reportPath of reportPaths) {
    await renderReview(reportPath);
  }
}

void main();
