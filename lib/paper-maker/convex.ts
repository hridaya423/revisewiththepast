import "server-only";

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { QuestionBankPart, SourcePageAsset } from "@/lib/paper-maker/aqa-geography";
import type { SubjectTierKey } from "@/lib/paper-maker/combined-science";

const QUESTION_BANK_CACHE_TTL_MS = 60_000;

let convexClient: ConvexHttpClient | null = null;
let cachedQuestionPageManifestBySourcePath: Map<string, SourcePageAsset[]> | null = null;

const questionBankCache = new Map<string, {
  expiresAt: number;
  questionParts: QuestionBankPart[];
}>();

function getConvexUrl() {
  const convexUrl = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("Missing CONVEX_URL or NEXT_PUBLIC_CONVEX_URL");
  }
  return convexUrl;
}

function getConvexClient() {
  if (convexClient) return convexClient;
  convexClient = new ConvexHttpClient(getConvexUrl());
  return convexClient;
}

function getQuestionPageManifestBySourcePath() {
  if (cachedQuestionPageManifestBySourcePath) return cachedQuestionPageManifestBySourcePath;

  const manifestPath = resolve(process.cwd(), "data/question-page-cdn-manifest.json");
  const bySourcePath = new Map<string, SourcePageAsset[]>();
  if (!existsSync(manifestPath)) {
    cachedQuestionPageManifestBySourcePath = bySourcePath;
    return bySourcePath;
  }

  const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    records?: Array<{
      sourceRelativePath: string;
      pageNumber: number;
      url: string;
      fileName: string;
      relativePath: string;
    }>;
  };

  for (const record of parsed.records ?? []) {
    const existing = bySourcePath.get(record.sourceRelativePath) ?? [];
    existing.push({
      sourceRelativePath: record.sourceRelativePath,
      pageNumber: record.pageNumber,
      cdnUrl: record.url,
      fileName: record.fileName,
      relativePath: record.relativePath,
    });
    bySourcePath.set(record.sourceRelativePath, existing);
  }

  for (const [sourceRelativePath, assets] of bySourcePath.entries()) {
    bySourcePath.set(sourceRelativePath, assets.sort((a, b) => a.pageNumber - b.pageNumber));
  }

  cachedQuestionPageManifestBySourcePath = bySourcePath;
  return bySourcePath;
}


export async function getPaperMakerQuestionBankFromConvex(
  boardCode: string,
  subjectSlug: string,
  options?: { cache?: boolean },
): Promise<QuestionBankPart[]> {
  const cacheKey = `${boardCode}::${subjectSlug}`;
  const now = Date.now();
  const useCache = options?.cache === true;

  if (useCache) {
    const cached = questionBankCache.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.questionParts;
  }

  const client = getConvexClient();
  const data = await client.query(api.questionTags.getPaperMakerQuestionBank, {
    boardCode,
    subjectSlug,
  });
  const questionParts = data.questionParts as QuestionBankPart[];

  if (useCache) {
    questionBankCache.set(cacheKey, {
      expiresAt: now + QUESTION_BANK_CACHE_TTL_MS,
      questionParts,
    });
  }

  return questionParts;
}

export async function getAqaGeographyQuestionBankFromConvex(): Promise<QuestionBankPart[]> {
  return getPaperMakerQuestionBankFromConvex("aqa", "geography");
}

export async function getTaggingCountsFromConvex() {
  const client = getConvexClient();
  return await client.query(api.questionTags.getTaggingCounts, {});
}

export async function getPaperAssetsByBoardSubjectFromConvex(boardCode: string, subjectSlug: string) {
  const client = getConvexClient();
  return await client.query(api.paperAssets.getPaperAssetsByBoardSubject, {
    boardCode,
    subjectSlug,
  });
}

export async function getInsertPageAssetUrlsBySourceRelativePaths(sourceRelativePaths: string[]) {
  const client = getConvexClient();
  const uniquePaths = Array.from(new Set(sourceRelativePaths));
  const assets = await client.query(api.insertPageAssets.getInsertPageAssetsBySourceRelativePaths, {
    sourceRelativePaths: uniquePaths,
  });

  const bySourcePath = new Map<string, Array<{ pageNumber: number; cdnUrl: string }>>();
  for (const asset of assets as Array<{ sourceRelativePath: string; pageNumber: number; cdnUrl: string }>) {
    const existing = bySourcePath.get(asset.sourceRelativePath) ?? [];
    existing.push({ pageNumber: asset.pageNumber, cdnUrl: asset.cdnUrl });
    bySourcePath.set(asset.sourceRelativePath, existing);
  }

  const result = new Map<string, string[]>();
  for (const sourceRelativePath of uniquePaths) {
    const pageUrls = (bySourcePath.get(sourceRelativePath) ?? [])
      .sort((a, b) => a.pageNumber - b.pageNumber)
      .map((row) => row.cdnUrl);
    result.set(sourceRelativePath, pageUrls);
  }

  return result;
}

export type PaperMakerSubjectDetailSnapshot = {
  key: string;
  taggedQuestionUnits: number;
  benchmarkMinutesPerMark: number | null;
  topics: unknown[];
  topicsByTier?: Partial<Record<SubjectTierKey, unknown[]>>;
  tiers: Array<{ key: SubjectTierKey; label: string; taggedQuestionUnits: number }>;
  detailLoaded: boolean;
};

export async function getSubjectDetailSnapshotFromConvex(boardCode: string, subjectSlug: string) {
  const client = getConvexClient();
  const snapshot = await client.query(api.questionTags.getSubjectDetailSnapshot, {
    boardCode,
    subjectSlug,
  });
  if (!snapshot) return null;
  return JSON.parse(snapshot.payloadJson) as PaperMakerSubjectDetailSnapshot;
}

export async function upsertSubjectDetailSnapshotInConvex(boardCode: string, subjectSlug: string, snapshot: PaperMakerSubjectDetailSnapshot) {
  const client = getConvexClient();
  await client.mutation(api.questionTags.upsertSubjectDetailSnapshot, {
    boardCode,
    subjectSlug,
    payloadJson: JSON.stringify(snapshot),
  });
}

export async function getQuestionPageAssetsBySourceRelativePaths(sourceRelativePaths: string[]) {
  const client = getConvexClient();
  const uniquePaths = Array.from(new Set(sourceRelativePaths));
  const assets = await client.query(api.questionPageAssets.getQuestionPageAssetsBySourceRelativePaths, {
    sourceRelativePaths: uniquePaths,
  });
  const bySourcePath = new Map<string, SourcePageAsset[]>();
  const manifestBySourcePath = getQuestionPageManifestBySourcePath();

  for (const asset of assets as Array<{ sourceRelativePath: string; pageNumber: number; cdnUrl: string; fileName: string; relativePath: string }>) {
    const existing = bySourcePath.get(asset.sourceRelativePath) ?? [];
    existing.push({
      sourceRelativePath: asset.sourceRelativePath,
      pageNumber: asset.pageNumber,
      cdnUrl: asset.cdnUrl,
      fileName: asset.fileName,
      relativePath: asset.relativePath,
    });
    bySourcePath.set(asset.sourceRelativePath, existing);
  }

  for (const sourceRelativePath of uniquePaths) {
    const existingAssets = (bySourcePath.get(sourceRelativePath) ?? []).sort((a, b) => a.pageNumber - b.pageNumber);
    if (existingAssets.length > 0) {
      bySourcePath.set(sourceRelativePath, existingAssets);
      continue;
    }

    bySourcePath.set(sourceRelativePath, manifestBySourcePath.get(sourceRelativePath) ?? []);
  }

  return bySourcePath;
}
