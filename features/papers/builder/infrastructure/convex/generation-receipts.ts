import "server-only";

import { ConvexHttpClient } from "convex/browser";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { fetchAuthMutation } from "@/shared/infrastructure/auth/convex";
import { getConvexUrl, getServerEnvironment } from "@/shared/infrastructure/env/server";

let client: ConvexHttpClient | null = null;

function getClient() {
  if (client) return client;
  client = new ConvexHttpClient(getConvexUrl());
  return client;
}

export async function recordGenerationReceipt(input: {
  pdfSha256: string;
  subjectKey: string;
  subjectTier?: "none" | "foundation" | "higher";
  selectedUnitKeys: string[];
  targetMarks: number;
  totalMarks: number;
  timeMinutes: number;
  questionCount: number;
}) {
  return await getClient().mutation(api.generationReceipts.recordGeneration, {
    serviceSecret: getServerEnvironment().MCP_SERVICE_SECRET ?? "",
    ...input,
  });
}

export async function claimGenerationReceipt(receiptId: string, pdfSha256: string) {
  return await fetchAuthMutation(api.generationReceipts.claimGenerationReceipt, {
    receiptId: receiptId as Id<"generationReceipts">,
    pdfSha256,
  });
}
