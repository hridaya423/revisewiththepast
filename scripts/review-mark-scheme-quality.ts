import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { SubjectTierKey } from "@/shared/domain/subject";
import type { PaperMakerSubjectKey } from "@/shared/domain/paper";
import { getMarkableUnitsByUnitKeys } from "@/features/papers/infrastructure/paper-maker";
import {
  detectPageQuestionNumber,
  loadMarkSchemeTextPages,
  locateMarkSchemePagesForUnit,
  normalizeQuestionNumber,
} from "@/features/papers/marking/infrastructure/mark-scheme/mark-scheme";

type PaperRunReport = {
  configKey: string;
  subjectKey: PaperMakerSubjectKey;
  subjectTier: SubjectTierKey | null;
  paperIndex: number;
  ok: boolean;
  selectedUnitKeys?: string[];
  markSchemeIncludedCount?: number;
  markSchemeFailureCount?: number;
  findings: Array<{ severity: "error" | "warning"; check: string; message: string }>;
};

type QaRunReport = { reports: PaperRunReport[] };

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function compact(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function hasIntroOrCoverLeak(text: string) {
  const normalized = compact(text).toLowerCase();
  return normalized.includes("mark schemes are prepared by the lead assessment writer")
    || normalized.includes("marking instructions preparation for marking")
    || normalized.includes("subject specific marking instructions")
    || normalized.includes("copyright information")
    || /\bversion:\s*\d/.test(normalized)
    || /\bgcse\s+[a-z ]+\s+\d{4}\/?\d?\s+paper\s+\d.*mark scheme/.test(normalized);
}

function wordSet(text: string) {
  const stop = new Set(["about", "after", "also", "both", "could", "describe", "does", "each", "explain", "from", "have", "into", "question", "show", "starting", "that", "their", "there", "these", "this", "using", "what", "when", "where", "which", "with", "write", "your"]);
  return new Set(compact(text).toLowerCase().match(/[a-z][a-z'-]{3,}/g)?.filter((word) => !stop.has(word)) ?? []);
}

function keywordOverlap(left: string, right: string) {
  const leftWords = wordSet(left);
  const rightWords = wordSet(right);
  let count = 0;
  for (const word of leftWords) if (rightWords.has(word)) count += 1;
  return count;
}

function englishLiteraturePattern(questionNumber: string, partNumber: string | null | undefined) {
  const question = `0?${normalizeQuestionNumber(questionNumber)}`;
  if (partNumber) return new RegExp(`\\bQuestion\\s+${question}\\s*\\.\\s*${partNumber}\\b|\\b${question}\\s*\\.\\s*${partNumber}\\b`, "i");
  return new RegExp(`\\bQuestion\\s+${question}\\b`, "i");
}

async function auditReport(reportPath: string) {
  const runDir = dirname(reportPath);
  const run = readJson<QaRunReport>(reportPath);
  const failures: string[] = [];
  const notes: unknown[] = [];

  for (const report of run.reports) {
    const selectedUnitKeys = report.selectedUnitKeys ?? [];
    const label = `${report.configKey} paper ${report.paperIndex + 1}`;
    try {
      assert.equal(report.ok, true, `${label}: generation failed`);
      assert.equal(report.findings.filter((finding) => finding.severity === "error").length, 0, `${label}: has deterministic error findings`);
      assert.ok(selectedUnitKeys.length > 0, `${label}: no selected units`);
      assert.equal(report.markSchemeIncludedCount, selectedUnitKeys.length, `${label}: markscheme unit coverage mismatch`);
      assert.equal(report.markSchemeFailureCount, 0, `${label}: markscheme assembly failures`);
      assert.ok(existsSync(resolve(runDir, report.configKey, `paper-${report.paperIndex + 1}`, "mark-scheme.pdf")), `${label}: missing mark-scheme.pdf`);

      const units = await getMarkableUnitsByUnitKeys(report.subjectKey, selectedUnitKeys, report.subjectTier);
      assert.equal(units.length, selectedUnitKeys.length, `${label}: could not resolve all selected units`);

      for (let index = 0; index < units.length; index += 1) {
        const unit = units[index];
        const unitLabel = `${label} Q${index + 1} ${unit.unitKey}`;
        const located = await locateMarkSchemePagesForUnit(unit);
        const allPages = await loadMarkSchemeTextPages(located.markSchemeAsset.relativePath, located.markSchemeAsset.cdnUrl);
        const text = compact(located.collectedPages.map((page) => page.text).join("\n"));
        const firstText = compact(located.collectedPages.slice(0, 2).map((page) => page.text).join("\n"));

        assert.ok(located.collectedPages.length > 0, `${unitLabel}: no isolated markscheme pages`);
        assert.equal(hasIntroOrCoverLeak(firstText), false, `${unitLabel}: starts with markscheme cover/intro boilerplate`);
        assert.ok(!(allPages.length > 6 && located.collectedPages.length >= allPages.length - 1), `${unitLabel}: selected almost the whole markscheme (${located.collectedPages.length}/${allPages.length} pages)`);

        if (unit.subjectSlug === "english-language") {
          const targetQuestions = new Set(unit.parts.map((part) => normalizeQuestionNumber(part.questionNumber)));
          for (const question of targetQuestions) {
            assert.match(text, new RegExp(`\\b0\\s*${question}\\b`, "i"), `${unitLabel}: missing selected English Language question ${question}`);
          }
          for (const match of text.matchAll(/\b0\s*(\d{1,2})\b/g)) {
            const question = normalizeQuestionNumber(match[1]);
            assert.ok(targetQuestions.has(question), `${unitLabel}: includes unrelated English Language question ${question}`);
          }
        } else if (unit.subjectSlug === "english-literature") {
          const partNumber = unit.parts.length === 1 ? unit.parts[0]?.questionPartNumber : null;
          assert.match(text, englishLiteraturePattern(unit.questionNumber, partNumber), `${unitLabel}: missing selected literature question heading`);
        } else {
          const targetQuestion = normalizeQuestionNumber(unit.questionNumber);
          const seenQuestions = new Set(located.collectedPages.map(detectPageQuestionNumber).filter(Boolean));
          assert.ok(seenQuestions.size === 0 || seenQuestions.has(targetQuestion), `${unitLabel}: does not include target question ${targetQuestion}`);
          for (const question of seenQuestions) {
            assert.equal(question, targetQuestion, `${unitLabel}: includes unrelated question ${question}`);
          }
        }

        const promptText = unit.parts.map((part) => `${part.contextText ?? ""} ${part.promptText}`).join(" ");
        notes.push({
          label: unitLabel,
          sourceQuestion: unit.questionNumber,
          sourceParts: unit.parts.map((part) => part.questionPartNumber).filter(Boolean),
          sourceMarks: unit.totalMarks,
          markSchemePages: located.collectedPages.map((page) => page.pageNumber),
          sourcePromptExcerpt: compact(promptText).slice(0, 500),
          markSchemeExcerpt: text.slice(0, 800),
          keywordOverlap: keywordOverlap(promptText, text),
        });
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  writeFileSync(resolve(runDir, "mark-scheme-quality-review.json"), JSON.stringify({ reportPath, notes }, null, 2));

  if (failures.length > 0) {
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log(`markscheme quality review passed (${run.reports.length} papers)`);
}

const reportPath = process.argv[2];
if (!reportPath) {
  console.error("Usage: tsx scripts/review-mark-scheme-quality.ts <qa-run-report.json>");
  process.exitCode = 1;
} else {
  auditReport(resolve(process.cwd(), reportPath)).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
