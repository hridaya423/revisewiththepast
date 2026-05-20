import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { GCSE_BOARDS, GCSE_SUBJECTS } from "../convex/gcseCatalog";

type SearchJob = {
  subjectSlug: string;
  subjectName: string;
  boardCode: string;
  boardName: string;
  tier: "none" | "foundation" | "higher";
  source: "pmt" | "revisionworld";
};

const TARGET_SOURCE = process.env.TARGET_SOURCE as "pmt" | "revisionworld" | undefined;

const SUBJECT_SOURCE: Partial<Record<string, "pmt" | "revisionworld">> = {
  biology: "revisionworld",
  business: "revisionworld",
  chemistry: "revisionworld",
  "combined-science": "revisionworld",
  "computer-science": "revisionworld",
  economics: "revisionworld",
  "english-language": "revisionworld",
  "english-literature": "revisionworld",
  french: "revisionworld",
  geography: "revisionworld",
  german: "revisionworld",
  history: "revisionworld",
  physics: "revisionworld",
  psychology: "revisionworld",
  sociology: "revisionworld",
  spanish: "revisionworld",
};

const PMT_SUPPORTED_SUBJECTS = new Set([
  "biology",
  "chemistry",
  "physics",
  "mathematics",
  "english-language",
  "english-literature",
  "economics",
  "geography",
  "history",
  "combined-science",
  "computer-science",
]);

const REVISIONWORLD_SUPPORTED_SUBJECTS = new Set([
  "biology",
  "business",
  "chemistry",
  "combined-science",
  "computer-science",
  "economics",
  "english-language",
  "english-literature",
  "french",
  "geography",
  "german",
  "history",
  "physics",
  "psychology",
  "sociology",
  "spanish",
]);

function isSourceSupported(subjectSlug: string, source: "pmt" | "revisionworld") {
  if (source === "pmt") return PMT_SUPPORTED_SUBJECTS.has(subjectSlug);
  return REVISIONWORLD_SUPPORTED_SUBJECTS.has(subjectSlug);
}

const jobs: SearchJob[] = GCSE_SUBJECTS.flatMap((subject) =>
  subject.boardConfigs.flatMap((config) => {
    const preferredSource = TARGET_SOURCE && isSourceSupported(subject.slug, TARGET_SOURCE)
      ? TARGET_SOURCE
      : undefined;
    const source = preferredSource ?? SUBJECT_SOURCE[subject.slug] ?? (PMT_SUPPORTED_SUBJECTS.has(subject.slug) ? "pmt" : undefined);
    if (!source) {
      return [];
    }

    if (!isSourceSupported(subject.slug, source)) {
      return [];
    }

    const boardName = GCSE_BOARDS.find((board) => board.code === config.boardCode)?.name ?? config.boardCode;
    const tiers = config.tierMode === "foundation_higher" ? (["foundation", "higher"] as const) : (["none"] as const);

    return tiers.map((tier) => ({
      subjectSlug: subject.slug,
      subjectName: subject.name,
      boardCode: config.boardCode,
      boardName,
      tier,
      source,
    }));
  }),
);

const payload = {
  generatedAt: new Date().toISOString(),
  totalJobs: jobs.length,
  jobs,
};

mkdirSync(resolve(process.cwd(), "data"), { recursive: true });
const outputPath = resolve(process.cwd(), "data/search-jobs.json");
writeFileSync(outputPath, JSON.stringify(payload, null, 2));
console.log(`Wrote ${jobs.length} search jobs to ${outputPath}`);
