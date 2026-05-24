import "server-only";

import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { QuestionBankPart, SourcePageAsset } from "@/lib/paper-maker/aqa-geography";

const QUESTION_BANK_CACHE_TTL_MS = 60_000;

let convexClient: ConvexHttpClient | null = null;

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

export async function getQuestionPageAssetsBySourceRelativePaths(sourceRelativePaths: string[]) {
  const client = getConvexClient();
  const uniquePaths = Array.from(new Set(sourceRelativePaths));
  const assets = await client.query(api.questionPageAssets.getQuestionPageAssetsBySourceRelativePaths, {
    sourceRelativePaths: uniquePaths,
  });
  const bySourcePath = new Map<string, SourcePageAsset[]>();

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
    const sortedAssets = (bySourcePath.get(sourceRelativePath) ?? []).sort((a, b) => a.pageNumber - b.pageNumber);
    bySourcePath.set(sourceRelativePath, sortedAssets);
  }

  return bySourcePath;
}
