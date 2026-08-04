import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { GCSE_SUBJECTS } from "../shared/domain/exam-catalog";

type Tier = "none" | "foundation" | "higher";
type Session = "june" | "november" | "january" | "unknown";
type DownloadKind = "question_paper" | "mark_scheme" | "insert";
type Source = "pmt" | "revisionworld";

type SearchJob = {
  subjectSlug: string;
  subjectName: string;
  boardCode: string;
  boardName: string;
  tier: Tier;
  source: Source;
};

type SearchJobsFile = {
  generatedAt: string;
  totalJobs: number;
  jobs: SearchJob[];
};

type DownloadRecord = {
  boardCode: string;
  subjectSlug: string;
  tier: Tier;
  year: number;
  paperCode: string;
  kind: DownloadKind;
  session: Session;
  filePath: string;
};

type JobIssue = {
  jobKey: string;
  boardCode: string;
  subjectSlug: string;
  tier: Tier;
  source: Source;
  downloadCount: number;
  missingPaperCodes: string[];
  missingYearsByPaperCode: Array<{
    paperCode: string;
    missingQuestionPaperYears: number[];
    missingMarkSchemeYears: number[];
  }>;
  actualPaperCodes: string[];
};

const JOBS_PATH = resolve(process.cwd(), "data/search-jobs.json");
const DOWNLOADS_DIR = resolve(process.cwd(), "data/downloads");
const OUTPUT_PATH = resolve(process.cwd(), "data/download-coverage-report.json");
const START_YEAR = 2018;
const END_YEAR = 2024;
const SUBJECT_START_YEAR_OVERRIDES: Partial<Record<string, number>> = {
  "computer-science": 2022,
};

function extractSessionFromText(text: string): Session {
  const lower = text.toLowerCase();
  if (lower.includes("november") || lower.includes(" nov ") || lower.startsWith("nov-")) {
    return "november";
  }
  if (lower.includes("june") || lower.includes(" jun ") || lower.startsWith("jun-")) {
    return "june";
  }
  if (lower.includes("january") || lower.includes(" jan ") || lower.startsWith("jan-")) {
    return "january";
  }
  return "unknown";
}

function buildJobKey(job: Pick<SearchJob, "boardCode" | "subjectSlug" | "tier">): string {
  return `${job.boardCode}:${job.subjectSlug}:${job.tier}`;
}

function getExpectedPaperCodes(boardCode: string, subjectSlug: string): string[] {
  const subject = GCSE_SUBJECTS.find((item) => item.slug === subjectSlug);
  const config = subject?.boardConfigs.find((item) => item.boardCode === boardCode);
  return (config?.papers ?? []).map((paper) => paper.code);
}

function getExpectedYears(subjectSlug: string): number[] {
  const startYear = SUBJECT_START_YEAR_OVERRIDES[subjectSlug] ?? START_YEAR;
  return Array.from({ length: END_YEAR - startYear + 1 }, (_, index) => startYear + index);
}

function scanDownloads(): { records: DownloadRecord[]; emptyLeafDirs: string[]; orphanJobDirs: string[] } {
  const records: DownloadRecord[] = [];
  const emptyLeafDirs: string[] = [];
  const orphanJobDirs: string[] = [];

  if (!existsSync(DOWNLOADS_DIR)) {
    return { records, emptyLeafDirs, orphanJobDirs };
  }

  const walk = (directoryPath: string): number => {
    const entries = readdirSync(directoryPath, { withFileTypes: true });
    let fileCount = 0;

    for (const entry of entries) {
      const fullPath = resolve(directoryPath, entry.name);
      if (entry.isDirectory()) {
        fileCount += walk(fullPath);
        continue;
      }

      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".pdf")) {
        continue;
      }

      fileCount += 1;
      const relParts = relative(DOWNLOADS_DIR, fullPath).split("/");
      if (relParts.length < 4) {
        continue;
      }

      const [boardCode, subjectSlug, tier, fileName] = relParts;
      const match = fileName.match(/^\d+-(\d{4})-([a-z0-9-]+)-(question_paper|mark_scheme|insert)-(.+)\.pdf$/i);
      if (!match) {
        continue;
      }

      records.push({
        boardCode,
        subjectSlug,
        tier: tier as Tier,
        year: Number(match[1]),
        paperCode: match[2],
        kind: match[3] as DownloadKind,
        session: extractSessionFromText(match[4]),
        filePath: fullPath,
      });
    }

    if (fileCount === 0 && directoryPath !== DOWNLOADS_DIR) {
      emptyLeafDirs.push(relative(process.cwd(), directoryPath));
    }

    return fileCount;
  };

  walk(DOWNLOADS_DIR);

  return { records, emptyLeafDirs, orphanJobDirs };
}

function main() {
  const jobsFile = JSON.parse(readFileSync(JOBS_PATH, "utf8")) as SearchJobsFile;
  const { records, emptyLeafDirs } = scanDownloads();
  const recordsByJob = new Map<string, DownloadRecord[]>();

  for (const record of records) {
    const jobKey = buildJobKey(record);
    const list = recordsByJob.get(jobKey) ?? [];
    list.push(record);
    recordsByJob.set(jobKey, list);
  }

  const jobsWithoutFiles: JobIssue[] = [];
  const jobsWithIssues: JobIssue[] = [];
  const coveredJobKeys = new Set<string>();

  for (const job of jobsFile.jobs) {
    const jobKey = buildJobKey(job);
    coveredJobKeys.add(jobKey);
    const jobRecords = recordsByJob.get(jobKey) ?? [];
    const expectedPaperCodes = getExpectedPaperCodes(job.boardCode, job.subjectSlug);
    const expectedYears = getExpectedYears(job.subjectSlug);
    const actualPaperCodes = Array.from(new Set(jobRecords.map((record) => record.paperCode))).sort();

    const missingPaperCodes = expectedPaperCodes.filter(
      (paperCode) => !jobRecords.some((record) => record.paperCode === paperCode || record.paperCode.startsWith(`${paperCode}-`)),
    );

    const missingYearsByPaperCode = expectedPaperCodes
      .map((paperCode) => {
        const matchingRecords = jobRecords.filter(
          (record) => record.paperCode === paperCode || record.paperCode.startsWith(`${paperCode}-`),
        );

        const missingQuestionPaperYears = expectedYears.filter(
          (year) => !matchingRecords.some((record) => record.year === year && record.kind === "question_paper"),
        );
        const missingMarkSchemeYears = expectedYears.filter(
          (year) => !matchingRecords.some((record) => record.year === year && record.kind === "mark_scheme"),
        );

        return {
          paperCode,
          missingQuestionPaperYears,
          missingMarkSchemeYears,
        };
      })
      .filter((entry) => entry.missingQuestionPaperYears.length > 0 || entry.missingMarkSchemeYears.length > 0);

    const issue: JobIssue = {
      jobKey,
      boardCode: job.boardCode,
      subjectSlug: job.subjectSlug,
      tier: job.tier,
      source: job.source,
      downloadCount: jobRecords.length,
      missingPaperCodes,
      missingYearsByPaperCode,
      actualPaperCodes,
    };

    if (jobRecords.length === 0) {
      jobsWithoutFiles.push(issue);
      continue;
    }

    if (missingPaperCodes.length > 0 || missingYearsByPaperCode.length > 0) {
      jobsWithIssues.push(issue);
    }
  }

  const orphanJobDirs = Array.from(
    new Set(
      records
        .map((record) => buildJobKey(record))
        .filter((jobKey) => !coveredJobKeys.has(jobKey)),
    ),
  ).sort();

  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      totalJobs: jobsFile.jobs.length,
      jobsWithFiles: jobsFile.jobs.length - jobsWithoutFiles.length,
      jobsWithoutFiles: jobsWithoutFiles.length,
      jobsWithIssues: jobsWithIssues.length,
      totalDownloadedFiles: records.length,
      emptyLeafDirs: emptyLeafDirs.length,
      orphanJobDirs: orphanJobDirs.length,
    },
    emptyLeafDirs,
    orphanJobDirs,
    jobsWithoutFiles,
    jobsWithIssues,
  };

  mkdirSync(resolve(process.cwd(), "data"), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2));
  console.log(`Wrote coverage report to ${OUTPUT_PATH}`);
  console.log(JSON.stringify(report.summary, null, 2));
}

main();
