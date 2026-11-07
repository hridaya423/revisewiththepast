import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { api } from "@/convex/_generated/api";
import { generatePaperRequestSchema } from "@/features/papers/builder/contracts/generate-paper";
import { getCallerKey } from "@/features/mcp/rate-limit";
import { normalizeApplicationError, RateLimitError } from "@/shared/application/errors";
import { assertGenerationOrigin, GENERATION_COOKIE, generationAccess } from "./generation-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const startJobSchema = z.object({
  request: generatePaperRequestSchema,
  paperCount: z.number().finite().transform((value) => Math.max(1, Math.min(3, Math.round(value)))).default(1),
  includeMarkScheme: z.boolean().default(false),
  requestKey: z.uuid(),
});

const jobIdSchema = z.object({ jobId: z.uuid() });
const cancelJobSchema = jobIdSchema.extend({ runVersion: z.number().int().nonnegative().default(0) });
const retrySchemeSchema = cancelJobSchema.extend({ paperIndex: z.number().int().min(0).max(2), requestKey: z.uuid() });
const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

function jobError(error: unknown, fallback: string) {
  const normalized = normalizeApplicationError(error, fallback);
  const headers: Record<string, string> = { ...privateHeaders };
  if (error instanceof RateLimitError) {
    headers["Retry-After"] = String(Math.max(1, Math.ceil((error.retryAt - Date.now()) / 1000)));
  }
  return new Response(normalized.message, { status: normalized.status, headers });
}

export async function startJob(request: NextRequest) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }
  const parsed = startJobSchema.safeParse(rawBody);
  if (!parsed.success) return new Response("Invalid generation job request.", { status: 400 });

  try {
    assertGenerationOrigin(request);
    const { client, secret, guestHash, capability } = await generationAccess(request, true);
    const result = await client.mutation(api.generationJobs.create, {
      serviceSecret: secret, jobId: randomUUID(), requestKey: parsed.data.requestKey, guestHash,
      callerKey: getCallerKey(request), requestJson: JSON.stringify(parsed.data.request),
      paperCount: parsed.data.paperCount, includeMarkScheme: parsed.data.includeMarkScheme,
    });
    if (result.unavailable) return new Response("This preparation request is unavailable. Try again to start a new paper.", { status: 403, headers: privateHeaders });
    if (result.workerUnavailable) return new Response("Paper preparation is temporarily unavailable. Your settings are saved. Please try again shortly.", { status: 503, headers: privateHeaders });
    if (!result.job) throw new RateLimitError("You have reached the current paper limit. Try again after it resets.", result.retryAt!);
    const response = NextResponse.json(result.job, { status: 202, headers: privateHeaders });
    response.cookies.set(GENERATION_COOKIE, capability, {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax",
      path: "/api/paper-maker", maxAge: 30 * 24 * 60 * 60,
    });
    return response;
  } catch (error) {
    console.error("Could not start generation job", { errorType: error instanceof Error ? error.name : "Unknown" });
    return jobError(error, "Failed to start paper generation.");
  }
}

export async function jobStatus(request: NextRequest) {
  const parsed = jobIdSchema.safeParse({ jobId: request.nextUrl.searchParams.get("jobId") });
  if (!parsed.success) return new Response("Missing jobId.", { status: 400 });
  try {
    const { client, secret, guestHash } = await generationAccess(request);
    const job = await client.query(api.generationJobs.read, { serviceSecret: secret, guestHash, jobId: parsed.data.jobId });
    if (!job) return new Response("This paper is unavailable or its access has expired.", { status: 404, headers: privateHeaders });
    return Response.json(job, { headers: privateHeaders });
  } catch (error) {
    return jobError(error, "We could not check this paper. Try again shortly.");
  }
}

export async function jobDownload(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId");
  const part = request.nextUrl.searchParams.get("part") ?? "combined";
  if (!jobId) return new Response("Missing jobId.", { status: 400 });
  if (!z.uuid().safeParse(jobId).success || !/^(combined|paper-\d|scheme-\d|preview-\d)$/.test(part)) return new Response("Invalid paper download.", { status: 400 });
  try {
    const { client, secret, guestHash } = await generationAccess(request);
    const file = await client.query(api.generationJobs.download, { serviceSecret: secret, guestHash, jobId, part });
    if (!file) return new Response("This file is unavailable or its access has expired.", { status: 404, headers: privateHeaders });
    const stored = await fetch(file.url, { cache: "no-store" });
    if (!stored.ok) return new Response("The file could not be opened. Please try again.", { status: 503, headers: privateHeaders });
    return new Response(stored.body, {
      headers: {
        ...privateHeaders, "Content-Type": file.contentType ?? "application/pdf",
        "Content-Disposition": `${request.nextUrl.searchParams.get("view") === "1" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      },
    });
  } catch (error) {
    return jobError(error, "The file could not be opened. Please try again.");
  }
}

export async function cancelJob(request: NextRequest) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }
  const parsed = cancelJobSchema.safeParse(rawBody);
  if (!parsed.success) return new Response("Missing jobId.", { status: 400 });
  try {
    assertGenerationOrigin(request);
    const { client, secret, guestHash } = await generationAccess(request);
    const job = await client.mutation(api.generationJobs.cancel, { serviceSecret: secret, guestHash, ...parsed.data });
    if (!job) return new Response("This paper is unavailable or its access has expired.", { status: 404, headers: privateHeaders });
    return Response.json(job, { headers: privateHeaders });
  } catch (error) {
    return jobError(error, "We could not stop preparation. Check its status before trying again.");
  }
}

export async function retrySchemeJob(request: NextRequest) {
  try {
    assertGenerationOrigin(request);
    const parsed = retrySchemeSchema.safeParse(await request.json());
    if (!parsed.success) return new Response("Invalid mark scheme retry.", { status: 400 });
    const { client, secret, guestHash } = await generationAccess(request);
    const result = await client.mutation(api.generationJobs.retryScheme, { serviceSecret: secret, guestHash, ...parsed.data, callerKey: getCallerKey(request) });
    if (result.unavailable) return new Response("This paper is unavailable or its access has expired.", { status: 403, headers: privateHeaders });
    if (result.workerUnavailable) return new Response("Preparation is temporarily unavailable. Your question paper is still ready.", { status: 503, headers: privateHeaders });
    if (!result.job) throw new RateLimitError("The mark scheme limit has been reached. Try again after it resets.", result.retryAt!);
    return Response.json(result.job, { status: 202, headers: privateHeaders });
  } catch (error) {
    return jobError(error, "We could not retry the mark scheme. Your question paper is still ready.");
  }
}

export async function claimJob(request: NextRequest) {
  try {
    assertGenerationOrigin(request);
    const parsed = jobIdSchema.safeParse(await request.json());
    if (!parsed.success) return new Response("Invalid paper.", { status: 400 });
    const { client, secret, guestHash } = await generationAccess(request);
    const job = await client.mutation(api.generationJobs.claim, { serviceSecret: secret, guestHash, jobId: parsed.data.jobId });
    if (!job) return new Response("Sign in to keep this paper.", { status: 401, headers: privateHeaders });
    return Response.json(job, { headers: privateHeaders });
  } catch (error) {
    return jobError(error, "We could not keep this paper. Please try again.");
  }
}
