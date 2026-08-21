
import { config as loadEnv } from "dotenv";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

loadEnv({ path: resolve(process.cwd(), ".env.local"), override: false, quiet: true });
loadEnv({ path: resolve(process.cwd(), ".env"), override: false, quiet: true });

import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { deriveSourceRelativePath, getFirstEnvironment } from "./runtime";

const CONVEX_URL = getFirstEnvironment("CONVEX_URL", "NEXT_PUBLIC_CONVEX_URL");

type ExtractedSpan = { page_number: number; y_top: number; y_bottom: number };
type ExtractedFigure = { label: string; page_number: number; y_top: number; y_bottom: number };
type ExtractedLayout = {
  page_number: number;
  page_width: number;
  page_height: number;
  content_x0: number;
  content_x1: number;
  header_floor_y: number;
  footer_ceiling_y: number;
};
type ExtractedPart = {
  question_id: string;
  region_spans?: ExtractedSpan[] | null;
  stem_spans?: ExtractedSpan[] | null;
  referenced_support_labels?: string[];
};
type ExtractedPaper = {
  source_file: string;
  board_code: string;
  subject_slug: string;
  parser_version: string;
  figures?: ExtractedFigure[];
  page_layouts?: ExtractedLayout[];
  question_parts: ExtractedPart[];
};

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  return {
    dir: resolve(process.cwd(), get("--dir") ?? "data/extracted"),
    board: get("--board") ?? null,
    subject: get("--subject") ?? null,
    limit: get("--limit") ? Number(get("--limit")) : Infinity,
    dryRun: args.includes("--dry-run"),
    maxUnmatchedRatio: get("--max-unmatched-ratio") ? Number(get("--max-unmatched-ratio")) : 0.05,
    concurrency: get("--concurrency") ? Number(get("--concurrency")) : 12,
  };
}

function findPaperJsonFiles(dir: string): string[] {
  const results: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = resolve(current, entry);
      const stats = statSync(full);
      if (stats.isDirectory()) {
        if (entry === "assets" || entry === "debug-spans") continue;
        walk(full);
      } else if (entry === "paper.json") {
        results.push(full);
      }
    }
  };
  walk(dir);
  return results;
}

const mapSpans = (spans?: ExtractedSpan[] | null) =>
  spans ? spans.map((s) => ({ pageNumber: s.page_number, yTop: s.y_top, yBottom: s.y_bottom })) : null;

async function main() {
  if (!CONVEX_URL) throw new Error("Missing CONVEX_URL or NEXT_PUBLIC_CONVEX_URL");
  const options = parseArgs();
  const client = new ConvexHttpClient(CONVEX_URL);

  const files = findPaperJsonFiles(options.dir);
  files.sort();

  const selected: Array<{ file: string; paper: ExtractedPaper; sourceRelativePath: string }> = [];
  let skippedNoRegions = 0;
  for (const file of files) {
    if (selected.length >= options.limit) break;
    let paper: ExtractedPaper;
    try {
      paper = JSON.parse(readFileSync(file, "utf8")) as ExtractedPaper;
    } catch {
      console.warn(`  ! could not parse ${file}`);
      continue;
    }
    if (options.board && paper.board_code !== options.board) continue;
    if (options.subject && paper.subject_slug !== options.subject) continue;
    if (!paper.page_layouts || !paper.figures || !paper.question_parts.some((p) => p.region_spans)) {
      skippedNoRegions += 1;
      continue;
    }
    selected.push({ file, paper, sourceRelativePath: deriveSourceRelativePath(paper.source_file) });
  }

  console.log(`Backfill: ${selected.length} region-aware papers (${skippedNoRegions} skipped: no regions)`);
  if (options.dryRun) console.log("DRY RUN — no writes");

  const aggregate = { applied: 0, refused: 0, partsPatched: 0, partsTotal: 0, unmatched: 0, figures: 0, layouts: 0 };
  const refusedPapers: string[] = [];

  let cursor = 0;
  async function worker() {
    while (cursor < selected.length) {
      const index = cursor++;
      const { paper, sourceRelativePath } = selected[index];
      const figures = (paper.figures ?? []).map((f) => ({
        label: f.label,
        pageNumber: f.page_number,
        yTop: f.y_top,
        yBottom: f.y_bottom,
      }));
      const pageLayouts = (paper.page_layouts ?? []).map((l) => ({
        pageNumber: l.page_number,
        pageWidth: l.page_width,
        pageHeight: l.page_height,
        contentX0: l.content_x0,
        contentX1: l.content_x1,
        headerFloorY: l.header_floor_y,
        footerCeilingY: l.footer_ceiling_y,
      }));
      const parts = paper.question_parts.map((p) => ({
        questionId: p.question_id,
        regionSpans: mapSpans(p.region_spans),
        stemSpans: mapSpans(p.stem_spans),
        referencedFigures: p.referenced_support_labels ?? [],
      }));

      if (options.dryRun) {
        console.log(`  ~ ${sourceRelativePath}: ${parts.length} parts, ${figures.length} figs, ${pageLayouts.length} layouts`);
        continue;
      }

      try {
        const result = await client.mutation(api.paperRegions.backfillPaperRegions, {
          sourceRelativePath,
          regionVersion: paper.parser_version,
          figures,
          pageLayouts,
          parts,
          maxUnmatchedRatio: options.maxUnmatchedRatio,
        });
        if (!result.applied) {
          aggregate.refused += 1;
          refusedPapers.push(`${sourceRelativePath} (${result.unmatched.length}/${result.partsTotal} unmatched)`);
          console.warn(`  ✗ refused ${sourceRelativePath}: ${(result.unmatchedRatio * 100).toFixed(0)}% unmatched — re-tag this paper`);
          continue;
        }
        aggregate.applied += 1;
        aggregate.partsPatched += result.patched;
        aggregate.partsTotal += result.partsTotal;
        aggregate.unmatched += result.unmatched.length;
        aggregate.figures += result.figures;
        aggregate.layouts += result.pageLayouts;
        if (result.taggedPaperCount === 0) {
          console.warn(`  · ${sourceRelativePath}: no tagged paper in Convex (figures/layouts written, 0 parts)`);
        } else if (result.unmatched.length > 0) {
          console.log(`  ✓ ${sourceRelativePath}: ${result.patched}/${result.partsTotal} parts (${result.unmatched.length} unmatched)`);
        }
      } catch (error) {
        console.error(`  ! error ${sourceRelativePath}: ${(error as Error).message}`);
        refusedPapers.push(`${sourceRelativePath} (error)`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(options.concurrency, selected.length) }, worker));

  console.log("\n=== Backfill summary ===");
  console.log(`Applied:        ${aggregate.applied} papers`);
  console.log(`Refused:        ${aggregate.refused} papers (>${(options.maxUnmatchedRatio * 100).toFixed(0)}% unmatched — need re-tag)`);
  console.log(`Parts patched:  ${aggregate.partsPatched}/${aggregate.partsTotal}`);
  console.log(`Unmatched parts:${aggregate.unmatched}`);
  console.log(`Figures:        ${aggregate.figures}`);
  console.log(`Page layouts:   ${aggregate.layouts}`);
  if (refusedPapers.length > 0) {
    console.log("\nRefused/errored papers:");
    for (const paper of refusedPapers) console.log(`  - ${paper}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
