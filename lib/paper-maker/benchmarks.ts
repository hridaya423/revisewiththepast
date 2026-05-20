import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { QuestionUnit } from "@/lib/paper-maker/aqa-geography";

export type RealPaperBenchmark = {
  sampleSize: number;
  averageMarks: number | null;
  averageTimeMinutes: number | null;
  averageMinutesPerMark: number | null;
  averageQuestionCount: number | null;
  papers: Array<{
    sourceRelativePath: string;
    paperCode: string;
    year: number | null;
    totalMarks: number;
    timeMinutes: number | null;
    questionCount: number;
  }>;
};

type ExtractedPaper = {
  pages?: Array<{
    page_text?: string;
  }>;
};

const extractedPaperMetricsCache = new Map<string, { totalMarks: number | null; timeMinutes: number | null }>();

function deriveExtractedPaperJsonPath(sourceRelativePath: string) {
  const normalizedPath = sourceRelativePath.replaceAll("\\", "/");
  const segments = normalizedPath.split("/").filter(Boolean);
  const boardCode = segments[0] ?? "";
  const subjectSlug = segments[1] ?? "";
  const fileName = segments.at(-1) ?? normalizedPath;
  const paperDirName = fileName.replace(/\.pdf$/i, "");
  return resolve(process.cwd(), "data/extracted", boardCode, subjectSlug, paperDirName, "paper.json");
}

function parseTimeAllowedMinutes(text: string) {
  const match = text.match(/time allowed:\s*(?:(\d+)\s*hour(?:s)?(?:\s*(\d+)\s*minutes?)?|(?:(\d+)\s*minutes?))/i);
  if (!match) return null;
  if (match[3]) return Number(match[3]);
  return (Number(match[1] ?? 0) * 60) + Number(match[2] ?? 0);
}

function parseTotalMarks(text: string) {
  const match = text.match(/total number of marks available for this paper is\s+(\d+)/i)
    ?? text.match(/total for paper\s*=\s*(\d+)\s+marks/i);
  return match ? Number(match[1]) : null;
}

export function getExtractedPaperMetrics(sourceRelativePath: string) {
  const cached = extractedPaperMetricsCache.get(sourceRelativePath);
  if (cached) return cached;

  const filePath = deriveExtractedPaperJsonPath(sourceRelativePath);
  if (!existsSync(filePath)) {
    const emptyMetrics = { totalMarks: null, timeMinutes: null };
    extractedPaperMetricsCache.set(sourceRelativePath, emptyMetrics);
    return emptyMetrics;
  }

  try {
    const paper = JSON.parse(readFileSync(filePath, "utf8")) as ExtractedPaper;
    const coverText = paper.pages?.[0]?.page_text ?? "";
    const metrics = {
      totalMarks: parseTotalMarks(coverText),
      timeMinutes: parseTimeAllowedMinutes(coverText),
    };
    extractedPaperMetricsCache.set(sourceRelativePath, metrics);
    return metrics;
  } catch {
    const emptyMetrics = { totalMarks: null, timeMinutes: null };
    extractedPaperMetricsCache.set(sourceRelativePath, emptyMetrics);
    return emptyMetrics;
  }
}

export function buildRealPaperBenchmark(units: QuestionUnit[]): RealPaperBenchmark {
  const papersBySource = new Map<string, {
    sourceRelativePath: string;
    paperCode: string;
    year: number | null;
    totalMarks: number;
    questionKeys: Set<string>;
  }>();

  for (const unit of units) {
    const existing = papersBySource.get(unit.sourceRelativePath) ?? {
      sourceRelativePath: unit.sourceRelativePath,
      paperCode: unit.paperCode,
      year: unit.year,
      totalMarks: 0,
      questionKeys: new Set<string>(),
    };

    existing.totalMarks += unit.totalMarks;
    existing.questionKeys.add(unit.sourceQuestionKey);
    papersBySource.set(unit.sourceRelativePath, existing);
  }

  const papers = Array.from(papersBySource.values())
    .map((paper) => {
      const extractedMetrics = getExtractedPaperMetrics(paper.sourceRelativePath);
      return {
        sourceRelativePath: paper.sourceRelativePath,
        paperCode: paper.paperCode,
        year: paper.year,
        totalMarks: extractedMetrics.totalMarks ?? paper.totalMarks,
        timeMinutes: extractedMetrics.timeMinutes,
        questionCount: paper.questionKeys.size,
      };
    })
    .filter((paper) => paper.totalMarks > 0)
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));

  if (papers.length === 0) {
    return {
      sampleSize: 0,
      averageMarks: null,
      averageTimeMinutes: null,
      averageMinutesPerMark: null,
      averageQuestionCount: null,
      papers: [],
    };
  }

  const papersWithTime = papers.filter((paper) => typeof paper.timeMinutes === "number" && paper.timeMinutes > 0);
  const averageMarks = papers.reduce((sum, paper) => sum + paper.totalMarks, 0) / papers.length;
  const averageQuestionCount = papers.reduce((sum, paper) => sum + paper.questionCount, 0) / papers.length;
  const averageTimeMinutes = papersWithTime.length > 0
    ? papersWithTime.reduce((sum, paper) => sum + (paper.timeMinutes ?? 0), 0) / papersWithTime.length
    : null;
  const averageMinutesPerMark = papersWithTime.length > 0
    ? papersWithTime.reduce((sum, paper) => sum + ((paper.timeMinutes ?? 0) / paper.totalMarks), 0) / papersWithTime.length
    : null;

  return {
    sampleSize: papers.length,
    averageMarks,
    averageTimeMinutes,
    averageMinutesPerMark,
    averageQuestionCount,
    papers,
  };
}

export function roundTargetMarks(value: number) {
  return Math.max(1, Math.min(200, Math.round(value)));
}

export function estimateMarksFromTimeMinutes(timeMinutes: number, benchmarkMinutesPerMark: number | null, fallbackMinutesPerMark: number) {
  const minutesPerMark = benchmarkMinutesPerMark && Number.isFinite(benchmarkMinutesPerMark) && benchmarkMinutesPerMark > 0
    ? benchmarkMinutesPerMark
    : fallbackMinutesPerMark;
  return roundTargetMarks(timeMinutes / minutesPerMark);
}
