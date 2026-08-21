import "server-only";

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ConvexHttpClient } from "convex/browser";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { QuestionBankPart, SourcePageAsset } from "@/shared/domain/paper";
import type { SubjectTierKey } from "@/shared/domain/subject";
import type { RegionFigure, RegionPageLayout } from "../builder/domain/region-render";
import { getConvexUrl, getServerEnvironment } from "@/shared/infrastructure/env/server";

const QUESTION_BANK_CACHE_TTL_MS = 60_000;
const questionPageManifestSchema = z.object({
  records: z.array(z.object({
    sourceRelativePath: z.string(),
    pageNumber: z.number(),
    url: z.url(),
    fileName: z.string(),
    relativePath: z.string(),
  })).optional(),
});

let convexClient: ConvexHttpClient | null = null;
let cachedQuestionPageManifestBySourcePath: Map<string, SourcePageAsset[]> | null = null;

const questionBankCache = new Map<string, {
  expiresAt: number;
  questionParts: QuestionBankPart[];
}>();

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

  const parsed = questionPageManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));

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
  const questionParts = data.questionParts satisfies QuestionBankPart[];

  if (useCache) {
    questionBankCache.set(cacheKey, {
      expiresAt: now + QUESTION_BANK_CACHE_TTL_MS,
      questionParts,
    });
  }

  return questionParts;
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

export type InsertPageAsset = {
  sourceRelativePath: string;
  pageNumber: number;
  cdnUrl: string;
  detectedSupportLabels: string[];
  ocrText: string;
};

export async function getInsertPageAssetsBySourceRelativePaths(sourceRelativePaths: string[]) {
  const client = getConvexClient();
  const uniquePaths = Array.from(new Set(sourceRelativePaths));
  const assets = await client.query(api.insertPageAssets.getInsertPageAssetsBySourceRelativePaths, {
    sourceRelativePaths: uniquePaths,
  });

  const bySourcePath = new Map<string, InsertPageAsset[]>();
  for (const asset of assets as Array<InsertPageAsset>) {
    const existing = bySourcePath.get(asset.sourceRelativePath) ?? [];
    existing.push(asset);
    bySourcePath.set(asset.sourceRelativePath, existing);
  }

  const result = new Map<string, InsertPageAsset[]>();
  for (const sourceRelativePath of uniquePaths) {
    result.set(
      sourceRelativePath,
      (bySourcePath.get(sourceRelativePath) ?? []).sort((a, b) => a.pageNumber - b.pageNumber),
    );
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
  const { MCP_SERVICE_SECRET } = getServerEnvironment();
  await client.mutation(api.questionTags.upsertSubjectDetailSnapshot, {
    serviceSecret: MCP_SERVICE_SECRET ?? "",
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

export type PaperFigureRow = RegionFigure & { sourceRelativePath: string };
export type PaperPageLayoutRow = RegionPageLayout & { sourceRelativePath: string };

export async function getPaperFiguresBySourceRelativePaths(sourceRelativePaths: string[]): Promise<Map<string, RegionFigure[]>> {
  const client = getConvexClient();
  const uniquePaths = Array.from(new Set(sourceRelativePaths));
  if (uniquePaths.length === 0) return new Map<string, RegionFigure[]>();
  const rows = await client.query(api.paperRegions.getPaperFigures, { sourceRelativePaths: uniquePaths });
  const bySourcePath = new Map<string, RegionFigure[]>();
  for (const row of rows as PaperFigureRow[]) {
    const existing = bySourcePath.get(row.sourceRelativePath) ?? [];
    existing.push(row);
    bySourcePath.set(row.sourceRelativePath, existing);
  }
  return bySourcePath;
}

export async function getPaperPageLayoutsBySourceRelativePaths(sourceRelativePaths: string[]): Promise<Map<string, RegionPageLayout[]>> {
  const client = getConvexClient();
  const uniquePaths = Array.from(new Set(sourceRelativePaths));
  if (uniquePaths.length === 0) return new Map<string, RegionPageLayout[]>();
  const rows = await client.query(api.paperRegions.getPaperPageLayouts, { sourceRelativePaths: uniquePaths });
  const bySourcePath = new Map<string, RegionPageLayout[]>();
  for (const row of rows as PaperPageLayoutRow[]) {
    const existing = bySourcePath.get(row.sourceRelativePath) ?? [];
    existing.push(row);
    bySourcePath.set(row.sourceRelativePath, existing);
  }
  return bySourcePath;
}
