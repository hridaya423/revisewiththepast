import "server-only";

import { timingSafeEqual } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { getServerEnvironment } from "@/shared/infrastructure/env/server";
import { convexIdSchema } from "../../contracts/shadow-paper";
import type { ShadowJobOutcome } from "../../application/generate-shadow-paper";

const workerRequestSchema = z.strictObject({ jobId: convexIdSchema });

export function hasServiceAuthorization(header: string | null, secret: string | undefined) {
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(secret);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export function workerResponseStatus(outcome: ShadowJobOutcome) {
  return outcome.kind === "skipped" && outcome.reason === "busy" ? 409 : 200;
}

export function createShadowWorkerHandler(run: (jobId: string) => Promise<ShadowJobOutcome>) {
  return async function shadowWorker(request: NextRequest | Request): Promise<Response> {
    if (!hasServiceAuthorization(request.headers.get("authorization"), getServerEnvironment().MCP_SERVICE_SECRET)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON body." }, { status: 400 });
    }
    const parsed = workerRequestSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: "Invalid worker request." }, { status: 400 });
    try {
      const outcome = await run(parsed.data.jobId);
      return Response.json({ outcome }, { status: workerResponseStatus(outcome) });
    } catch (error) {
      // The job record is untouched or still leased; a 503 lets the dispatcher retry with backoff.
      console.error("Shadow worker could not reach its dependencies", { message: error instanceof Error ? error.message : String(error) });
      return Response.json({ error: "Worker dependencies unavailable." }, { status: 503 });
    }
  };
}

export async function shadowWorker(request: NextRequest) {
  const { processShadowJob } = await import("../jobs/worker");
  return createShadowWorkerHandler(processShadowJob)(request);
}
