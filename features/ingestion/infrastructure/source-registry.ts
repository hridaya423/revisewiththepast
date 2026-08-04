import { GCSE_BOARDS, GCSE_SUBJECTS } from "@/shared/domain/exam-catalog";
import type { GcseBoardCode } from "@/shared/domain/exam";

export type SourceProvider = "search" | "firecrawl" | "exa";

export type SubjectSourcePlan = {
  subjectSlug: string;
  subjectName: string;
  boardCode: GcseBoardCode;
  boardName: string;
  tierMode: "none" | "foundation_higher";
  provider: SourceProvider;
  preferredDomains: string[];
  firecrawlSeedUrls: string[];
  includeKeywords: string[];
  excludeKeywords: string[];
};

const HIGH_SIGNAL_DOMAINS = [
  "revisionmaths.com",
  "physicsandmathstutor.com",
  "mathsmadeeasy.co.uk",
  "savemyexams.com",
  "mme-revision.co.uk",
  "cognitoedu.org",
];

function boardSlugForQuery(boardCode: GcseBoardCode): string {
  const board = GCSE_BOARDS.find((b) => b.code === boardCode);
  return board?.name ?? boardCode;
}

function buildSeedUrls(boardCode: GcseBoardCode, subjectName: string): string[] {
  const query = encodeURIComponent(`${boardSlugForQuery(boardCode)} GCSE ${subjectName} past papers`);
  return [
    `https://www.google.com/search?q=${query}`,
    `https://duckduckgo.com/?q=${query}`,
  ];
}

export const SUBJECT_SOURCE_REGISTRY: SubjectSourcePlan[] = GCSE_SUBJECTS.flatMap((subject) =>
  subject.boardConfigs.map((config) => ({
    subjectSlug: subject.slug,
    subjectName: subject.name,
    boardCode: config.boardCode,
    boardName: boardSlugForQuery(config.boardCode),
    tierMode: config.tierMode,
    provider: "search",
    preferredDomains: HIGH_SIGNAL_DOMAINS,
    firecrawlSeedUrls: buildSeedUrls(config.boardCode, subject.name),
    includeKeywords: [
      "past papers",
      "question paper",
      "mark scheme",
      "gcse",
    ],
    excludeKeywords: [
      "a-level",
      "as-level",
      "international gcse",
      "specimen",
      "examiner report",
    ],
  })),
);
