import { z } from "zod";

import { RateLimitError } from "@/shared/application/errors";
import { listSourcePapers, summariseManifest } from "../../application/list-source-papers";
import { artifactKindSchema, convexIdSchema, sourcePaperIdSchema, startShadowJobRequestSchema, type ShadowArtifactKind, type ShadowManifest } from "../../contracts/shadow-paper";

export type ShadowJobView = {
  jobId: string;
  status: string;
  sourcePaperId: string;
  manifestRevision: string;
  progress: { completedUnits: number; totalUnits: number };
  cancelRequested: boolean;
  errorCode?: string;
  createdAt: number;
  updatedAt: number;
  variantId?: string;
  variant: Record<string, unknown> | null;
  expired?: boolean;
};

export type ShadowArtifactLink = { url: string; fileName: string; sha256: string; fileSize: number; displayCode: string };

/** Server capabilities the shadow routes depend on; production wiring lives in `shadow-http-deps.ts`. */
export type ShadowHttpDeps = {
  enabled(): boolean;
  manifests(): readonly ShadowManifest[];
  authToken(request: Request): Promise<string | null>;
  reserve(request: Request): Promise<void>;
  startJob(token: string, input: { sourcePaperId: string; manifestRevision: string; idempotencyKey: string; totalUnits: number }): Promise<{ created: boolean; job: ShadowJobView }>;
  getJob(token: string, jobId: string): Promise<ShadowJobView | null>;
  getActiveJob(token: string): Promise<ShadowJobView | null>;
  cancelJob(token: string, jobId: string): Promise<ShadowJobView | null>;
  getVariant(token: string, variantId: string): Promise<Record<string, unknown> | null>;
  getArtifact(token: string, variantId: string, kind: ShadowArtifactKind): Promise<ShadowArtifactLink | null>;
  saveVariant(token: string, variantId: string): Promise<{ savedPaperId: string; created: boolean }>;
  fetchArtifact(url: string): Promise<Response>;
  worker(request: Request): Promise<Response>;
  afterStart?(jobId: string): void;
};

type Handler = (request: Request, params: Record<string, string>, deps: ShadowHttpDeps) => Promise<Response>;

const KNOWN_CODES = ["IDEMPOTENCY_CONFLICT", "ACTIVE_JOB_LIMIT", "INVALID_REQUEST", "NOT_FOUND", "EXPIRED", "MISSING_SNAPSHOT", "Unauthorized"] as const;

export function errorResponse(status: number, code: string, message: string, headers: Record<string, string> = {}) {
  return Response.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function convexErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return KNOWN_CODES.find((code) => message.includes(code)) ?? null;
}

function mapFailure(error: unknown, context: string): Response {
  if (error instanceof RateLimitError) {
    return errorResponse(429, "RATE_LIMITED", "You have generated a lot of papers this hour. Try again later.", { "Retry-After": String(Math.max(1, Math.ceil((error.retryAt - Date.now()) / 1000))) });
  }
  switch (convexErrorCode(error)) {
    case "Unauthorized": return errorResponse(401, "AUTHENTICATION_REQUIRED", "Sign in to continue.");
    case "IDEMPOTENCY_CONFLICT": return errorResponse(409, "IDEMPOTENCY_CONFLICT", "This request key was already used for a different paper. Start again.");
    case "ACTIVE_JOB_LIMIT": return errorResponse(429, "ACTIVE_JOB_LIMIT", "A shadow paper is already being generated. Wait for it to finish or cancel it.");
    case "INVALID_REQUEST": return errorResponse(400, "INVALID_REQUEST", "The request was not valid.");
    case "NOT_FOUND": return errorResponse(404, "NOT_FOUND", "This shadow paper was not found.");
    case "EXPIRED": return errorResponse(410, "EXPIRED", "This shadow paper has expired. Generate a new version.");
    case "MISSING_SNAPSHOT": return errorResponse(409, "MISSING_SNAPSHOT", "This shadow paper is incomplete and cannot be saved.");
    default:
      console.error(`Shadow ${context} failed`, { message: error instanceof Error ? error.message : String(error) });
      return errorResponse(503, "UNAVAILABLE", "Shadow papers are temporarily unavailable. Try again shortly.");
  }
}

async function requireToken(request: Request, deps: ShadowHttpDeps) {
  try {
    return await deps.authToken(request);
  } catch {
    return null;
  }
}

async function readJson(request: Request) {
  try {
    return { ok: true as const, value: (await request.json()) as unknown };
  } catch {
    return { ok: false as const };
  }
}

const catalogue: Handler = async (_request, _params, deps) => {
  return json({ enabled: deps.enabled(), papers: listSourcePapers(deps.manifests()) });
};

const catalogueEntry: Handler = async (_request, params, deps) => {
  const parsed = sourcePaperIdSchema.safeParse(params.sourcePaperId);
  if (!parsed.success) return errorResponse(404, "NOT_FOUND", "This paper is not available as a shadow paper.");
  const manifest = listSourcePapers(deps.manifests()).find((entry) => entry.sourcePaperId === parsed.data);
  if (!manifest) return errorResponse(404, "NOT_FOUND", "This paper is not available as a shadow paper.");
  return json({ enabled: deps.enabled(), paper: manifest });
};

const startJob: Handler = async (request, _params, deps) => {
  if (!deps.enabled()) return errorResponse(503, "SHADOW_DISABLED", "Shadow paper generation is turned off right now.");
  const body = await readJson(request);
  if (!body.ok) return errorResponse(400, "INVALID_REQUEST", "Send a JSON body.");
  const parsed = startShadowJobRequestSchema.safeParse(body.value);
  if (!parsed.success) return errorResponse(400, "INVALID_REQUEST", "The request was not valid.");
  const token = await requireToken(request, deps);
  if (!token) return errorResponse(401, "AUTHENTICATION_REQUIRED", "Sign in to generate a shadow paper.");
  const manifest = deps.manifests().find((entry) => entry.source.sourcePaperId === parsed.data.sourcePaperId);
  if (!manifest) return errorResponse(404, "NOT_FOUND", "This paper is not available as a shadow paper.");
  if (manifest.revision !== parsed.data.manifestRevision) {
    return Response.json({ error: { code: "MANIFEST_STALE", message: "This paper was updated. Refresh to use the latest version." }, paper: summariseManifest(manifest) }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  try {
    await deps.reserve(request);
    const result = await deps.startJob(token, { ...parsed.data, totalUnits: manifest.units.length });
    if (result.created) deps.afterStart?.(result.job.jobId);
    return Response.json({ job: result.job, statusUrl: `/api/paper-maker/shadow-jobs/${result.job.jobId}` }, { status: result.created ? 202 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapFailure(error, "job start");
  }
};

function idParam(value: string | undefined) {
  const parsed = convexIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

const jobStatus: Handler = async (request, params, deps) => {
  const jobId = idParam(params.jobId);
  if (!jobId) return errorResponse(404, "NOT_FOUND", "This generation job was not found.");
  const token = await requireToken(request, deps);
  if (!token) return errorResponse(401, "AUTHENTICATION_REQUIRED", "Sign in to continue.");
  try {
    const job = await deps.getJob(token, jobId);
    return job ? json({ job }) : errorResponse(404, "NOT_FOUND", "This generation job was not found.");
  } catch (error) {
    return mapFailure(error, "job status");
  }
};

const activeJob: Handler = async (request, _params, deps) => {
  const token = await requireToken(request, deps);
  if (!token) return errorResponse(401, "AUTHENTICATION_REQUIRED", "Sign in to continue.");
  try {
    return json({ job: await deps.getActiveJob(token) });
  } catch (error) {
    return mapFailure(error, "active job");
  }
};

const cancelJob: Handler = async (request, params, deps) => {
  const jobId = idParam(params.jobId);
  if (!jobId) return errorResponse(404, "NOT_FOUND", "This generation job was not found.");
  const token = await requireToken(request, deps);
  if (!token) return errorResponse(401, "AUTHENTICATION_REQUIRED", "Sign in to continue.");
  try {
    const job = await deps.cancelJob(token, jobId);
    return job ? json({ job }) : errorResponse(404, "NOT_FOUND", "This generation job was not found.");
  } catch (error) {
    return mapFailure(error, "job cancel");
  }
};

const variantSummary: Handler = async (request, params, deps) => {
  const variantId = idParam(params.variantId);
  if (!variantId) return errorResponse(404, "NOT_FOUND", "This shadow paper was not found.");
  const token = await requireToken(request, deps);
  if (!token) return errorResponse(401, "AUTHENTICATION_REQUIRED", "Sign in to continue.");
  try {
    const variant = await deps.getVariant(token, variantId);
    return variant ? json({ variant }) : errorResponse(404, "NOT_FOUND", "This shadow paper was not found or has expired.");
  } catch (error) {
    return mapFailure(error, "variant");
  }
};

const safeFileName = (value: string) => value.replace(/[^A-Za-z0-9._-]/gu, "-").slice(0, 160);

const download: Handler = async (request, params, deps) => {
  const kind = artifactKindSchema.safeParse(new URL(request.url).searchParams.get("kind"));
  if (!kind.success) return errorResponse(400, "INVALID_REQUEST", "Choose kind=paper or kind=mark-scheme.");
  const variantId = idParam(params.variantId);
  if (!variantId) return errorResponse(404, "NOT_FOUND", "This shadow paper was not found.");
  const token = await requireToken(request, deps);
  if (!token) return errorResponse(401, "AUTHENTICATION_REQUIRED", "Sign in to download this paper.");
  try {
    const artifact = await deps.getArtifact(token, variantId, kind.data);
    if (!artifact) return errorResponse(404, "NOT_FOUND", "This shadow paper was not found or has expired.");
    const upstream = await deps.fetchArtifact(artifact.url);
    if (!upstream.ok || !upstream.body) return errorResponse(503, "UNAVAILABLE", "The file is temporarily unavailable. Try again shortly.");
    return new Response(upstream.body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safeFileName(artifact.fileName)}"`,
        "Content-Length": String(artifact.fileSize),
        "Cache-Control": "private, no-store",
        ETag: `"${artifact.sha256}"`,
        "X-Shadow-Variant": artifact.displayCode,
      },
    });
  } catch (error) {
    return mapFailure(error, "download");
  }
};

const save: Handler = async (request, params, deps) => {
  const variantId = idParam(params.variantId);
  if (!variantId) return errorResponse(404, "NOT_FOUND", "This shadow paper was not found.");
  const body = await readJson(request);
  if (body.ok && body.value !== null && !z.strictObject({}).safeParse(body.value).success) {
    return errorResponse(400, "INVALID_REQUEST", "Saving takes no request fields.");
  }
  const token = await requireToken(request, deps);
  if (!token) return errorResponse(401, "AUTHENTICATION_REQUIRED", "Sign in to save this paper.");
  try {
    const result = await deps.saveVariant(token, variantId);
    return json(result, result.created ? 201 : 200);
  } catch (error) {
    return mapFailure(error, "save");
  }
};

type Route = { method: "GET" | "POST"; pattern: string[]; handler: Handler };

const ROUTES: Route[] = [
  { method: "GET", pattern: ["shadow-papers"], handler: catalogue },
  { method: "GET", pattern: ["shadow-papers", ":sourcePaperId"], handler: catalogueEntry },
  { method: "POST", pattern: ["shadow-jobs", "worker"], handler: (request, _params, deps) => deps.worker(request) },
  { method: "POST", pattern: ["shadow-jobs"], handler: startJob },
  { method: "GET", pattern: ["shadow-jobs", "active"], handler: activeJob },
  { method: "GET", pattern: ["shadow-jobs", ":jobId"], handler: jobStatus },
  { method: "POST", pattern: ["shadow-jobs", ":jobId", "cancel"], handler: cancelJob },
  { method: "GET", pattern: ["shadow-variants", ":variantId"], handler: variantSummary },
  { method: "GET", pattern: ["shadow-variants", ":variantId", "download"], handler: download },
  { method: "POST", pattern: ["shadow-variants", ":variantId", "save"], handler: save },
];

/** Matches literal segments before parameters, so reserved paths such as `shadow-jobs/worker` never reach `:jobId`. */
export function matchShadowRoute(method: string, segments: readonly string[]) {
  for (const route of ROUTES) {
    if (route.method !== method || route.pattern.length !== segments.length) continue;
    const params: Record<string, string> = {};
    const matches = route.pattern.every((part, index) => {
      if (part.startsWith(":")) {
        params[part.slice(1)] = segments[index]!;
        return true;
      }
      return part === segments[index];
    });
    if (matches) return { handler: route.handler, params };
  }
  return null;
}

export function isShadowPath(segments: readonly string[]) {
  return segments[0] === "shadow-papers" || segments[0] === "shadow-jobs" || segments[0] === "shadow-variants";
}
