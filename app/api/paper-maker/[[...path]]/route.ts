import { NextRequest } from "next/server";

import { POST as generate } from "@/features/papers/builder/infrastructure/http/generate";
import { POST as generateMarkScheme } from "@/features/papers/builder/infrastructure/http/generate-mark-scheme";
import { POST as saveGenerated } from "@/features/papers/builder/infrastructure/http/save-generated";
import { GET as subjectDetail } from "@/features/papers/builder/infrastructure/http/subject-detail";
import { cancelJob, claimJob, jobDownload, jobStatus, retrySchemeJob, startJob } from "@/features/papers/builder/infrastructure/http/generation-jobs";
import { isShadowPath, matchShadowRoute } from "@/features/papers/shadow/infrastructure/http/shadow-routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ path?: string[] }> };

const postHandlers: Record<string, (request: NextRequest) => Promise<Response>> = {
  generate,
  "generate-mark-scheme": generateMarkScheme,
  "save-generated": saveGenerated,
  "generation-jobs": startJob,
  "generation-jobs/cancel": cancelJob,
  "generation-jobs/claim": claimJob,
  "generation-jobs/retry-scheme": retrySchemeJob,
};

const getHandlers: Record<string, (request: NextRequest) => Promise<Response>> = {
  "subject-detail": subjectDetail,
  "generation-jobs": jobStatus,
  "generation-jobs/download": jobDownload,
};

async function routeShadow(method: "GET" | "POST", request: NextRequest, segments: string[]) {
  const match = matchShadowRoute(method, segments);
  if (!match) return Response.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });
  const { createShadowHttpDeps } = await import("@/features/papers/shadow/infrastructure/http/shadow-http-deps");
  return match.handler(request, match.params, createShadowHttpDeps());
}

export async function GET(request: NextRequest, context: Context) {
  const segments = (await context.params).path ?? [];
  if (isShadowPath(segments)) return routeShadow("GET", request, segments);
  const path = segments.join("/");
  return path && getHandlers[path] ? getHandlers[path](request) : new Response("Not found", { status: 404 });
}

export async function POST(request: NextRequest, context: Context) {
  const segments = (await context.params).path ?? [];
  if (isShadowPath(segments)) return routeShadow("POST", request, segments);
  const path = segments.join("/");
  return path && postHandlers[path] ? postHandlers[path](request) : new Response("Not found", { status: 404 });
}
