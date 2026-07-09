import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { config as loadEnv } from "dotenv";

loadEnv({ path: resolve(process.cwd(), ".env.local"), override: false, quiet: true });
loadEnv({ path: resolve(process.cwd(), ".env"), override: false, quiet: true });

import { generateCustomPaper, PaperGenerationError } from "@/lib/paper-maker/generate";
import type { QuestionMixProfile } from "@/lib/paper-maker/aqa-geography";
import { PAPER_MAKER_SUBJECTS } from "@/lib/paper-maker/subjects";
import type { SubjectTierKey } from "@/lib/paper-maker/combined-science";
import { renderPdfToPngBuffers } from "@/lib/marking/pdfjs-server";
import { assembleMarkSchemePdf } from "@/lib/marking/mark-scheme";
import { runDeterministicChecks } from "@/lib/paper-maker/validate";

type CliOptions = {
  subject: string;
  papers: number;
  seed: number;
  marks: number;
  mix: QuestionMixProfile;
  out: string;
  renderScale: number;
};

type QaCheckFinding = {
  check: string;
  severity: "error" | "warning";
  message: string;
  pageNumber?: number;
  unitKey?: string;
};

type PaperRunReport = {
  configKey: string;
  subjectKey: string;
  subjectTier: SubjectTierKey | null;
  paperIndex: number;
  seed: number;
  ok: boolean;
  error?: string;
  durationMs: number;
  pageCount?: number;
  totalMarks?: number;
  resolvedTargetMarks?: number;
  selectedUnitKeys?: string[];
  selectedSourceQuestionKeys?: string[];
  selectedUnitMarks?: number[];
  selectedCoveredLeafTopicIds?: string[];
  markSchemeIncludedCount?: number;
  markSchemeFailureCount?: number;
  findings: QaCheckFinding[];
};

type PriorSelectionState = {
  sourceQuestionKeys: string[];
  unitMarks: number[];
  paperCount: number;
  coveredLeafTopicIds: string[];
};

function shouldExcludeWholeSourceQuestion(subjectKey: string) {
  return subjectKey === "aqa-business" || subjectKey === "edexcel-business" || subjectKey === "aqa-english-language";
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    subject: "all",
    papers: 3,
    seed: 42,
    marks: 40,
    mix: "balanced",
    out: "qa-reports",
    renderScale: 2,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      const value = argv[index];
      if (value === undefined) throw new Error(`Missing value for ${arg}`);
      return value;
    };

    if (arg === "--subject") options.subject = next();
    else if (arg === "--papers") options.papers = Math.max(1, Number.parseInt(next(), 10) || 1);
    else if (arg === "--seed") options.seed = Number.parseInt(next(), 10) || 42;
    else if (arg === "--marks") options.marks = Math.max(1, Math.min(200, Number.parseInt(next(), 10) || 40));
    else if (arg === "--mix") {
      const value = next();
      if (value !== "balanced" && value !== "short-form" && value !== "long-form") throw new Error(`Unknown mix: ${value}`);
      options.mix = value;
    }
    else if (arg === "--out") options.out = next();
    else if (arg === "--scale") options.renderScale = Math.max(1, Math.min(4, Number.parseFloat(next()) || 2));
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

type SubjectRunConfig = {
  configKey: string;
  subjectKey: string;
  subjectTier: SubjectTierKey | null;
};

function buildSubjectMatrix(subjectFilter: string): SubjectRunConfig[] {
  const configs: SubjectRunConfig[] = [];
  for (const subject of PAPER_MAKER_SUBJECTS) {
    if (!subject.generationEnabled) continue;
    if (subject.tiers.length > 0) {
      for (const tier of subject.tiers) {
        configs.push({
          configKey: `${subject.key}-${tier.key}`,
          subjectKey: subject.key,
          subjectTier: tier.key,
        });
      }
    } else {
      configs.push({ configKey: subject.key, subjectKey: subject.key, subjectTier: null });
    }
  }

  if (subjectFilter === "all") return configs;
  const filtered = configs.filter(
    (config) => config.configKey === subjectFilter || config.subjectKey === subjectFilter,
  );
  if (filtered.length === 0) {
    const known = configs.map((config) => config.configKey).join(", ");
    throw new Error(`Unknown subject "${subjectFilter}". Known configs: ${known}`);
  }
  return filtered;
}

async function runPaper(
  config: SubjectRunConfig,
  paperIndex: number,
  options: CliOptions,
  paperDir: string,
  priorState: PriorSelectionState,
): Promise<PaperRunReport> {
  const seed = options.seed + paperIndex * 1000;
  const startedAt = Date.now();
  const report: PaperRunReport = {
    configKey: config.configKey,
    subjectKey: config.subjectKey,
    subjectTier: config.subjectTier,
    paperIndex,
    seed,
    ok: false,
    durationMs: 0,
    findings: [],
  };

  try {
    const result = await generateCustomPaper({
      subjectKey: config.subjectKey,
      subjectTier: config.subjectTier ?? undefined,
      selectedTopicNodeIds: [],
      selectAllTopics: true,
      targetMarks: options.marks,
      questionMix: options.mix,
      targetMode: "marks",
      paperCodes: [],
      excludeSourceQuestionKeys: priorState.sourceQuestionKeys,
      remainingPaperCount: Math.max(1, options.papers - paperIndex),
      priorSelectedUnitMarks: priorState.unitMarks,
      priorPaperCount: priorState.paperCount,
      priorCoveredLeafTopicIds: priorState.coveredLeafTopicIds,
      seed,
    });

    mkdirSync(paperDir, { recursive: true });
    writeFileSync(resolve(paperDir, result.fileName), Buffer.from(result.pdfBytes));

    const rendered = await renderPdfToPngBuffers(result.pdfBytes, options.renderScale);
    for (const page of rendered.pages) {
      const pageName = `page-${String(page.pageNumber).padStart(2, "0")}.png`;
      writeFileSync(resolve(paperDir, pageName), page.png);
    }

    report.findings = await runDeterministicChecks(rendered.pages, rendered.textPages, {
      subjectKey: config.subjectKey,
      totalMarks: result.selection.totalMarks,
      selectedUnitCount: result.selection.selectedUnits.length,
      selectedUnitMarks: result.selection.selectedUnits.map((unit) => unit.totalMarks),
    });
    for (const issue of result.figureIntegrityIssues) {
      report.findings.push({
        check: "orphan-figure",
        severity: "error",
        message: `Unit ${issue.unitKey} renders ${issue.figureLabel} (source page ${issue.pageNumber}) but no part references it.`,
      });
    }

    try {
      const markScheme = await assembleMarkSchemePdf(result.selection.selectedUnits);
      writeFileSync(resolve(paperDir, "mark-scheme.pdf"), Buffer.from(markScheme.bytes));
      report.markSchemeIncludedCount = markScheme.includedCount;
      report.markSchemeFailureCount = markScheme.failures.length;
      if (markScheme.includedCount !== result.selection.selectedUnits.length) {
        report.findings.push({
          check: "mark-scheme-coverage",
          severity: "error",
          message: `Assembled ${markScheme.includedCount}/${result.selection.selectedUnits.length} selected unit mark schemes.`,
        });
      }
      for (const failure of markScheme.failures) {
        report.findings.push({
          check: "mark-scheme-assembly",
          severity: "error",
          unitKey: failure.unitKey,
          message: `${failure.label}: ${failure.error}`,
        });
      }
    } catch (error) {
      report.markSchemeIncludedCount = 0;
      report.markSchemeFailureCount = result.selection.selectedUnits.length;
      report.findings.push({
        check: "mark-scheme-assembly",
        severity: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }

    report.ok = true;
    report.pageCount = rendered.pages.length;
    report.totalMarks = result.selection.totalMarks;
    report.resolvedTargetMarks = result.resolvedTargetMarks;
    report.selectedUnitKeys = result.selection.selectedUnits.map((unit) => unit.unitKey);
    report.selectedSourceQuestionKeys = result.selection.selectedUnits.map((unit) => unit.sourceQuestionKey);
    report.selectedUnitMarks = result.selection.selectedUnits.map((unit) => unit.totalMarks);
    report.selectedCoveredLeafTopicIds = result.selection.coveredLeafTopicIds;

    priorState.sourceQuestionKeys.push(...result.selection.selectedUnits.map((unit) => (
      shouldExcludeWholeSourceQuestion(config.subjectKey) ? unit.sourceQuestionKey : unit.unitKey
    )));
    priorState.unitMarks.push(...report.selectedUnitMarks);
    priorState.paperCount += 1;
    priorState.coveredLeafTopicIds.push(...report.selectedCoveredLeafTopicIds);
  } catch (error) {
    report.error = error instanceof PaperGenerationError
      ? `${error.status}: ${error.message}`
      : error instanceof Error
        ? `${error.message}\n${error.stack ?? ""}`
        : String(error);
  }

  report.durationMs = Date.now() - startedAt;
  return report;
}

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const configs = buildSubjectMatrix(options.subject);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runDir = resolve(process.cwd(), options.out, timestamp);
  mkdirSync(runDir, { recursive: true });


  const reports: PaperRunReport[] = [];
  const priorSelectionByConfig = new Map<string, PriorSelectionState>();
  for (const config of configs) {
    const priorState = priorSelectionByConfig.get(config.configKey) ?? {
      sourceQuestionKeys: [],
      unitMarks: [],
      paperCount: 0,
      coveredLeafTopicIds: [],
    };
    priorSelectionByConfig.set(config.configKey, priorState);

    for (let paperIndex = 0; paperIndex < options.papers; paperIndex += 1) {
      const paperDir = resolve(runDir, config.configKey, `paper-${paperIndex + 1}`);
      const label = `${config.configKey} paper ${paperIndex + 1}/${options.papers}`;
      process.stdout.write(`→ ${label} ... `);
      const report = await runPaper(config, paperIndex, options, paperDir, priorState);
      reports.push(report);
      if (report.ok) {
        const errors = report.findings.filter((finding) => finding.severity === "error").length;
        const warnings = report.findings.length - errors;
        const findingLabel = report.findings.length > 0 ? ` [${errors} err, ${warnings} warn]` : "";
        console.log(`ok (${report.pageCount} pages, ${report.totalMarks} marks, ${report.durationMs}ms)${findingLabel}`);
        writeFileSync(resolve(paperDir, "report.json"), JSON.stringify(report, null, 2));
      } else {
        console.log(`FAILED: ${report.error?.split("\n")[0]}`);
        mkdirSync(paperDir, { recursive: true });
        writeFileSync(resolve(paperDir, "report.json"), JSON.stringify(report, null, 2));
      }
    }
  }

  const failures = reports.filter((report) => !report.ok);
  const findingCount = reports.reduce((sum, report) => sum + report.findings.length, 0);
  const summary = {
    generatedAt: new Date().toISOString(),
    options,
    configCount: configs.length,
    paperCount: reports.length,
    generationFailures: failures.length,
    findingCount,
    reports,
  };
  writeFileSync(resolve(runDir, "report.json"), JSON.stringify(summary, null, 2));

  console.log("");
  console.log(`Papers generated: ${reports.length - failures.length}/${reports.length}`);
  if (failures.length > 0) {
    console.log("Failures:");
    for (const failure of failures) {
      console.log(`  - ${failure.configKey} paper ${failure.paperIndex + 1}: ${failure.error?.split("\n")[0]}`);
    }
  }

  const byCheck = new Map<string, number>();
  const byConfigErrors = new Map<string, number>();
  for (const report of reports) {
    for (const finding of report.findings) {
      const key = `${finding.check}/${finding.severity}`;
      byCheck.set(key, (byCheck.get(key) ?? 0) + 1);
      if (finding.severity === "error") {
        byConfigErrors.set(report.configKey, (byConfigErrors.get(report.configKey) ?? 0) + 1);
      }
    }
  }
  console.log(`\nDeterministic findings (${findingCount} total):`);
  if (byCheck.size === 0) {
    console.log("  none 🎉");
  } else {
    for (const [key, count] of Array.from(byCheck).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${key.padEnd(28)} ${count}`);
    }
    console.log("Error findings by subject:");
    for (const [configKey, count] of Array.from(byConfigErrors).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${configKey.padEnd(32)} ${count}`);
    }
  }

  console.log(`\nReport: ${resolve(runDir, "report.json")}`);
  const errorFindingCount = reports.reduce(
    (sum, report) => sum + report.findings.filter((finding) => finding.severity === "error").length,
    0,
  );
  process.exitCode = failures.length > 0 || errorFindingCount > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
