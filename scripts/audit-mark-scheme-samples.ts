import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import assert from "node:assert/strict";

import { extractPdfPageTexts, getPdfDocument } from "@/features/papers/infrastructure/pdfjs-server";

type PaperRunReport = {
  configKey: string;
  paperIndex: number;
  ok: boolean;
  findings: Array<{ severity: "error" | "warning"; check: string; message: string }>;
  selectedUnitKeys?: string[];
  markSchemeIncludedCount?: number;
  markSchemeFailureCount?: number;
};

type QaRunReport = {
  reports: PaperRunReport[];
};

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function expectedLabel(index: number) {
  return `Q${index} ·`;
}

function expectedTableQuestion(index: number) {
  return String(index).padStart(2, "0");
}

async function readPdfText(path: string) {
  const bytes = new Uint8Array(readFileSync(path));
  const document = await getPdfDocument(bytes);
  const pages = await extractPdfPageTexts(document);
  return pages.map((page) => page.text).join("\n");
}

function hasIntroOrCoverLeak(text: string) {
  const normalized = text.replace(/\s+/g, " ").toLowerCase();
  return normalized.includes("mark schemes are prepared by the lead assessment writer")
    || normalized.includes("marking instructions preparation for marking")
    || normalized.includes("subject specific marking instructions")
    || /\bversion:\s*\d/.test(normalized)
    || /\bgcse\s+[a-z ]+\s+\d{4}\/?\d?\s+paper\s+\d.*mark scheme/.test(normalized);
}

function unexpectedTableQuestionRows(text: string, selectedCount: number) {
  const leaks: string[] = [];
  const rowStart = /(?:^|\n)\s*(\d{1,2})\s+(?:[a-z]|[ivx]+|\([a-z]\))\b/gi;
  for (const match of text.matchAll(rowStart)) {
    const value = Number(match[1]);
    if (value > selectedCount) leaks.push(match[1]);
  }
  return Array.from(new Set(leaks));
}

async function auditReport(runReportPath: string) {
  const runDir = dirname(runReportPath);
  const run = readJson<QaRunReport>(runReportPath);
  const failures: string[] = [];

  for (const report of run.reports) {
    const selectedCount = report.selectedUnitKeys?.length ?? 0;
    const label = `${report.configKey} paper ${report.paperIndex + 1}`;
    try {
      assert.equal(report.ok, true, `${label}: paper generation failed`);
      assert.equal(report.findings.filter((finding) => finding.severity === "error").length, 0, `${label}: has QA error findings`);
      assert.ok(selectedCount > 0, `${label}: no selected units`);
      assert.equal(report.markSchemeIncludedCount, selectedCount, `${label}: markscheme coverage mismatch`);
      assert.equal(report.markSchemeFailureCount, 0, `${label}: markscheme assembly failures`);

      const markSchemePath = resolve(runDir, report.configKey, `paper-${report.paperIndex + 1}`, "mark-scheme.pdf");
      assert.ok(existsSync(markSchemePath), `${label}: missing mark-scheme.pdf`);

      const text = await readPdfText(markSchemePath);
      assert.equal(hasIntroOrCoverLeak(text.slice(0, 2500)), false, `${label}: markscheme starts with cover/intro pages, not the selected question content`);
      let cursor = -1;
      for (let index = 1; index <= selectedCount; index += 1) {
        const labelCursor = text.indexOf(expectedLabel(index), cursor + 1);
        const tableCursor = text.indexOf(expectedTableQuestion(index), cursor + 1);
        const nextCursor = [labelCursor, tableCursor].filter((value) => value > cursor).sort((a, b) => a - b)[0] ?? -1;
        assert.ok(nextCursor > cursor, `${label}: missing or out-of-order ${expectedLabel(index)} / ${expectedTableQuestion(index)}`);
        cursor = nextCursor;
      }
      assert.equal(text.indexOf(expectedLabel(selectedCount + 1)), -1, `${label}: contains unexpected extra ${expectedLabel(selectedCount + 1)}`);
      const leakedRows = unexpectedTableQuestionRows(text, selectedCount);
      assert.equal(leakedRows.length, 0, `${label}: contains unselected markscheme table rows ${leakedRows.join(", ")}`);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log(`markscheme sample audit passed (${run.reports.length} papers)`);
}

const reportPath = process.argv[2];
if (!reportPath) {
  console.error("Usage: tsx scripts/audit-mark-scheme-samples.ts <qa-run-report.json>");
  process.exitCode = 1;
} else {
  auditReport(resolve(process.cwd(), reportPath)).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
