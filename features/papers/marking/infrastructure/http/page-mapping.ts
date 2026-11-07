import { NextRequest } from "next/server";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { fetchAuthMutation } from "@/shared/infrastructure/auth/convex";
import { requireAuthToken, unauthorizedResponse } from "@/shared/infrastructure/auth/tokens";
import { normalizeApplicationError } from "@/shared/application/errors";
import { convexIdSchema, uploadMappingSchema } from "../../contracts/http";

const mappingSchema = uploadMappingSchema.extend({ pageId: convexIdSchema, questionKeys: uploadMappingSchema.shape.questionKeys.min(0) });
const headers = { "Cache-Control": "private, no-store" };

export async function POST(request: NextRequest) {
  if (!await requireAuthToken(request.headers).catch(() => null)) return unauthorizedResponse();
  const parsed = mappingSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response("Check the page and question choices.", { status: 400, headers });
  try {
    const { submissionId, pageId, questionKeys } = parsed.data;
    const result = await fetchAuthMutation(api.marking.setResponsePageTargets, { submissionId: submissionId as Id<"markingSubmissions">, pageId: pageId as Id<"markingResponsePages">, questionKeys });
    return Response.json({ questionKeys: result }, { headers });
  } catch (error) {
    const normalized = normalizeApplicationError(error, "Could not update this page. Please try again.");
    return new Response(normalized.message, { status: normalized.status, headers });
  }
}
