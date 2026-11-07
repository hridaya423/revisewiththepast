import { z } from "zod";

import type { ShadowJob } from "./state";

const BASE = "/api/paper-maker";

const sourcePaperSchema = z.object({
  sourcePaperId: z.string(),
  manifestRevision: z.string(),
  publicationStatus: z.enum(["draft", "approved", "withdrawn"]),
  board: z.object({ code: z.string(), label: z.string() }),
  subject: z.object({ key: z.string(), label: z.string() }),
  specCode: z.string(),
  componentCode: z.string(),
  tier: z.enum(["higher", "foundation"]),
  year: z.number(),
  session: z.enum(["june", "november"]),
  sittingDate: z.string(),
  paperCode: z.string(),
  paperTitle: z.string(),
  calculator: z.enum(["allowed", "not-allowed"]),
  durationMinutes: z.number(),
  totalMarks: z.number(),
  questionCount: z.number(),
  unchangedQuestionCount: z.number(),
  topics: z.array(z.string()),
});
export type ShadowSourcePaper = z.infer<typeof sourcePaperSchema>;

const catalogueSchema = z.object({ enabled: z.boolean(), papers: z.array(sourcePaperSchema) });

const variantSchema = z.object({
  variantId: z.string(),
  displayCode: z.string(),
  title: z.string(),
  totalMarks: z.number(),
  durationMinutes: z.number(),
  questionCount: z.number(),
  paperPages: z.number(),
  markSchemePages: z.number(),
  createdAt: z.number(),
  expiresAt: z.number().nullable(),
  savedPaperId: z.string().nullable(),
});

const jobSchema = z.object({
  jobId: z.string(),
  status: z.enum(["queued", "generating", "validating", "rendering", "ready", "failed", "cancelled"]),
  sourcePaperId: z.string(),
  manifestRevision: z.string(),
  progress: z.object({ completedUnits: z.number(), totalUnits: z.number() }),
  cancelRequested: z.boolean(),
  errorCode: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  variant: variantSchema.nullable(),
  expired: z.boolean().optional(),
}) satisfies z.ZodType<ShadowJob>;

const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

export class ShadowApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
    this.name = "ShadowApiError";
  }
}

async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/${path}`, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  } catch {
    throw new ShadowApiError("NETWORK", "You appear to be offline.", 0);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = errorSchema.safeParse(body);
    throw new ShadowApiError(parsed.success ? parsed.data.error.code : "UNKNOWN", parsed.success ? parsed.data.error.message : "Something went wrong.", response.status);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ShadowApiError("BAD_RESPONSE", "The server sent an unexpected response.", response.status);
  return parsed.data;
}

export const shadowApi = {
  catalogue: () => request("shadow-papers", catalogueSchema),
  start: (input: { sourcePaperId: string; manifestRevision: string; idempotencyKey: string }) =>
    request("shadow-jobs", z.object({ job: jobSchema }), { method: "POST", body: JSON.stringify(input) }).then((result) => result.job),
  job: (jobId: string) => request(`shadow-jobs/${encodeURIComponent(jobId)}`, z.object({ job: jobSchema })).then((result) => result.job),
  activeJob: () => request("shadow-jobs/active", z.object({ job: jobSchema.nullable() })).then((result) => result.job),
  cancel: (jobId: string) => request(`shadow-jobs/${encodeURIComponent(jobId)}/cancel`, z.object({ job: jobSchema }), { method: "POST", body: "{}" }).then((result) => result.job),
  save: (variantId: string) => request(`shadow-variants/${encodeURIComponent(variantId)}/save`, z.object({ savedPaperId: z.string(), created: z.boolean() }), { method: "POST", body: "{}" }),
};
