import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { config as loadEnv } from "dotenv";

loadEnv({ path: resolve(process.cwd(), ".env.local"), override: false, quiet: true });
loadEnv({ path: resolve(process.cwd(), ".env"), override: false, quiet: true });

import { generateCustomPaper, PaperGenerationError, type GenerationTimings } from "@/features/papers/builder/infrastructure/generation/generate";
import type { QuestionMixProfile } from "@/shared/domain/paper";
import type { SubjectTierKey } from "@/shared/domain/subject";
import { assembleMarkSchemePdf } from "@/features/papers/marking/infrastructure/mark-scheme/mark-scheme";
import { runDeterministicChecks } from "@/features/papers/builder/infrastructure/qa/validate";
import { checkQuestionLayout } from "@/features/papers/builder/infrastructure/qa/question-layout";
import { decideQaPaperGate, type QaArtifactValidation } from "./qa-paper-gate";
import { buildQaPaperMatrix, type QaPaperConfig } from "./qa-paper-matrix";
import { inspectQaPdfArtifact, invalidQaPdfArtifact } from "./qa-pdf-artifact";

type CliOptions = {
  subject: string;
  papers: number;
  seed: number;
  marks: number;
  mix: QuestionMixProfile;
  out: string;
  renderScale: number;
  topic: string | null;
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
  paperCode: string;
  paperIndex: number;
  seed: number;
  ok: boolean;
  error?: string;
  durationMs: number;
  generationTimings?: GenerationTimings;
  postGenerationTimings?: {
    questionPaperInspectionMs: number;
    deterministicChecksMs: number;
    markSchemeAssemblyMs: number;
    markSchemeInspectionMs: number;
  };
  pageCount?: number;
  totalMarks?: number;
  resolvedTargetMarks?: number;
  selectedUnitKeys?: string[];
  selectedSourceQuestionKeys?: string[];
  selectedUnitMarks?: number[];
  selectedCoveredLeafTopicIds?: string[];
  markSchemeIncludedCount?: number;
  markSchemeFailureCount?: number;
  questionPaperArtifact?: QaArtifactValidation;
  markSchemeArtifact?: QaArtifactValidation;
  gateFailures?: string[];
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
    topic: null,
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
    else if (arg === "--topic") options.topic = next();
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

async function runPaper(
  config: QaPaperConfig,
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
    paperCode: config.paperCode,
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
      selectedTopicNodeIds: options.topic ? [options.topic] : [],
      selectAllTopics: !options.topic,
      targetMarks: options.marks,
      questionMix: options.mix,
      targetMode: "marks",
      paperCodes: [config.paperCode],
      excludeSourceQuestionKeys: priorState.sourceQuestionKeys,
      remainingPaperCount: Math.max(1, options.papers - paperIndex),
      priorSelectedUnitMarks: priorState.unitMarks,
      priorPaperCount: priorState.paperCount,
      priorCoveredLeafTopicIds: priorState.coveredLeafTopicIds,
      seed,
    });
    report.generationTimings = result.timings;
    report.postGenerationTimings = {
      questionPaperInspectionMs: 0,
      deterministicChecksMs: 0,
      markSchemeAssemblyMs: 0,
      markSchemeInspectionMs: 0,
    };

    mkdirSync(paperDir, { recursive: true });
    let stageStartedAt = performance.now();
    const questionPaperValidation = await inspectQaPdfArtifact(result.pdfBytes, options.renderScale);
    report.postGenerationTimings.questionPaperInspectionMs = performance.now() - stageStartedAt;
    report.questionPaperArtifact = questionPaperValidation.artifact;
    if (questionPaperValidation.rendered) {
      writeFileSync(resolve(paperDir, result.fileName), Buffer.from(result.pdfBytes));
      for (const page of questionPaperValidation.rendered.pages) {
        const pageName = `page-${String(page.pageNumber).padStart(2, "0")}.png`;
        writeFileSync(resolve(paperDir, pageName), page.png);
      }
      stageStartedAt = performance.now();
      const deterministicFindings = await runDeterministicChecks(questionPaperValidation.rendered.pages, questionPaperValidation.rendered.textPages, {
        subjectKey: config.subjectKey,
        totalMarks: result.selection.totalMarks,
        selectedUnitCount: result.selection.selectedUnits.length,
        expectedOrdinalCount: result.selection.selectedUnits.length,
        selectedUnitMarks: result.selection.selectedUnits.map((unit) => unit.totalMarks),
        candidateUnitMarks: result.selection.candidateUnitMarks,
        coverPage: {
          totalMarks: result.coverPage.totalMarks,
          timeMinutes: result.coverPage.timeMinutes,
          questionCount: result.coverPage.questionCount,
        },
      });
      report.findings = [
        ...deterministicFindings,
        ...await checkQuestionLayout(result.pdfBytes, {
          subjectKey: config.subjectKey,
          selectedUnitCount: result.selection.selectedUnits.length,
          expectedOrdinalCount: result.selection.selectedUnits.length,
        }),
      ];
      report.postGenerationTimings.deterministicChecksMs = performance.now() - stageStartedAt;
    } else {
      report.findings.push({
        check: "question-paper-artifact",
        severity: "error",
        message: "Question paper PDF was empty or unreadable.",
      });
    }
    for (const issue of result.figureIntegrityIssues) {
      report.findings.push({
        check: "orphan-figure",
        severity: "error",
        message: `Unit ${issue.unitKey} renders ${issue.figureLabel} (source page ${issue.pageNumber}) but no part references it.`,
      });
    }

    let markSchemeArtifact = invalidQaPdfArtifact(0);
    try {
      stageStartedAt = performance.now();
      const markScheme = await assembleMarkSchemePdf(result.selection.selectedUnits, {
        revisionPaperCode: result.coverPage.revisionPaperCode,
      });
      report.postGenerationTimings.markSchemeAssemblyMs = performance.now() - stageStartedAt;
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
      stageStartedAt = performance.now();
      const markSchemeValidation = await inspectQaPdfArtifact(markScheme.bytes, 1);
      report.postGenerationTimings.markSchemeInspectionMs = performance.now() - stageStartedAt;
      markSchemeArtifact = markSchemeValidation.artifact;
      if (markSchemeValidation.rendered) {
        writeFileSync(resolve(paperDir, "mark-scheme.pdf"), Buffer.from(markScheme.bytes));
      } else {
        report.findings.push({
          check: "mark-scheme-artifact",
          severity: "error",
          message: "Mark scheme PDF was empty or unreadable.",
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

    report.markSchemeArtifact = markSchemeArtifact;
    report.pageCount = questionPaperValidation.artifact.renderedPageCount;
    report.totalMarks = result.selection.totalMarks;
    report.resolvedTargetMarks = result.resolvedTargetMarks;
    report.selectedUnitKeys = result.selection.selectedUnits.map((unit) => unit.unitKey);
    report.selectedSourceQuestionKeys = result.selection.selectedUnits.map((unit) => unit.sourceQuestionKey);
    report.selectedUnitMarks = result.selection.selectedUnits.map((unit) => unit.totalMarks);
    report.selectedCoveredLeafTopicIds = result.selection.coveredLeafTopicIds;
    const gate = decideQaPaperGate({
      findings: report.findings,
      canonicalLayoutChecked: questionPaperValidation.rendered !== null,
      selectedUnitCount: result.selection.selectedUnits.length,
      markSchemeIncludedCount: report.markSchemeIncludedCount ?? 0,
      markSchemeFailureCount: report.markSchemeFailureCount ?? result.selection.selectedUnits.length,
      questionPaper: questionPaperValidation.artifact,
      markScheme: markSchemeArtifact,
    });
    report.ok = gate.ok;
    report.gateFailures = gate.failures;
    if (!report.ok) report.error = `QA gate failed: ${gate.failures.join(", ")}`;

    if (report.ok) {
      priorState.sourceQuestionKeys.push(...result.selection.selectedUnits.map((unit) => (
        shouldExcludeWholeSourceQuestion(config.subjectKey) ? unit.sourceQuestionKey : unit.unitKey
      )));
      priorState.unitMarks.push(...report.selectedUnitMarks);
      priorState.paperCount += 1;
      priorState.coveredLeafTopicIds.push(...report.selectedCoveredLeafTopicIds);
    }
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
  const configs = options.subject.split(",").flatMap((filter) => buildQaPaperMatrix(filter.trim()));
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
  process.exitCode = failures.length > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
