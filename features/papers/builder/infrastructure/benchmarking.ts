import type { QuestionUnit } from "@/shared/domain/paper";
import { readExtractedPaperJson } from "./extracted-store";

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

function parseTimeAllowedMinutes(text: string) {
  const match = text.match(/time allowed:\s*(?:(\d+)\s*hour(?:s)?(?:\s*(\d+)\s*minutes?)?|(?:(\d+)\s*minutes?))/i);
  if (!match) return null;
  if (match[3]) return Number(match[3]);
  return (Number(match[1] ?? 0) * 60) + Number(match[2] ?? 0);
}

function parseTotalMarks(text: string) {
  const match = text.match(/total number of marks available for this paper is\s+(\d+)/i)
    ?? text.match(/total for paper\s*=\s*(\d+)\s+marks/i)
    ?? text.match(/(?:maximum|total) (?:number of )?marks? for this paper is\s+(\d+)/i);
  return match ? Number(match[1]) : null;
}

export function getExtractedPaperMetrics(sourceRelativePath: string) {
  const cached = extractedPaperMetricsCache.get(sourceRelativePath);
  if (cached) return cached;

  const paper = readExtractedPaperJson<ExtractedPaper>(sourceRelativePath);
  const coverText = paper?.pages?.[0]?.page_text ?? "";
  const metrics = {
    totalMarks: parseTotalMarks(coverText),
    timeMinutes: parseTimeAllowedMinutes(coverText),
  };
  extractedPaperMetricsCache.set(sourceRelativePath, metrics);
  return metrics;
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
        declaredTotalMarks: extractedMetrics.totalMarks,
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
  const papersWithTimeAndDeclaredMarks = papersWithTime.filter(
    (paper) => typeof paper.declaredTotalMarks === "number" && paper.declaredTotalMarks > 0,
  );
  const averageMarks = papers.reduce((sum, paper) => sum + paper.totalMarks, 0) / papers.length;
  const averageQuestionCount = papers.reduce((sum, paper) => sum + paper.questionCount, 0) / papers.length;
  const averageTimeMinutes = papersWithTime.length > 0
    ? papersWithTime.reduce((sum, paper) => sum + (paper.timeMinutes ?? 0), 0) / papersWithTime.length
    : null;
  const averageMinutesPerMark = papersWithTimeAndDeclaredMarks.length > 0
    ? papersWithTimeAndDeclaredMarks.reduce((sum, paper) => sum + ((paper.timeMinutes ?? 0) / (paper.declaredTotalMarks ?? 1)), 0) / papersWithTimeAndDeclaredMarks.length
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
