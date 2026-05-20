import "server-only";

import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { QuestionBankPart, SourcePageAsset } from "@/lib/paper-maker/aqa-geography";

function getConvexUrl() {
  const convexUrl = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("Missing CONVEX_URL or NEXT_PUBLIC_CONVEX_URL");
  }
  return convexUrl;
}

export async function getPaperMakerQuestionBankFromConvex(boardCode: string, subjectSlug: string): Promise<QuestionBankPart[]> {
  const client = new ConvexHttpClient(getConvexUrl());
  const data = await client.query(api.questionTags.getPaperMakerQuestionBank, {
    boardCode,
    subjectSlug,
  });
  return data.questionParts as QuestionBankPart[];
}

export async function getAqaGeographyQuestionBankFromConvex(): Promise<QuestionBankPart[]> {
  return getPaperMakerQuestionBankFromConvex("aqa", "geography");
}

export async function getQuestionPageAssetsBySourceRelativePaths(sourceRelativePaths: string[]) {
  const client = new ConvexHttpClient(getConvexUrl());
  const uniquePaths = Array.from(new Set(sourceRelativePaths));
  const entries = await Promise.all(uniquePaths.map(async (sourceRelativePath) => {
    const assets = await client.query(api.questionPageAssets.getQuestionPageAssetsBySourceRelativePath, {
      sourceRelativePath,
    });

    return [
      sourceRelativePath,
      (assets as Array<{ sourceRelativePath: string; pageNumber: number; cdnUrl: string; fileName: string; relativePath: string }>)
        .map((asset) => ({
          sourceRelativePath: asset.sourceRelativePath,
          pageNumber: asset.pageNumber,
          cdnUrl: asset.cdnUrl,
          fileName: asset.fileName,
          relativePath: asset.relativePath,
        }))
        .sort((a, b) => a.pageNumber - b.pageNumber),
    ] as const;
  }));

  return new Map<string, SourcePageAsset[]>(entries);
}
