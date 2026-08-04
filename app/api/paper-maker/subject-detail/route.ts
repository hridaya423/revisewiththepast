import { NextRequest } from "next/server";

import { getSubjectDetail } from "@/features/papers/server";
import { normalizeApplicationError } from "@/shared/application/errors";

function badRequest(message: string, status = 400) {
  return new Response(message, { status });
}

export async function GET(request: NextRequest) {
  const subjectKey = request.nextUrl.searchParams.get("subjectKey");
  if (!subjectKey) return badRequest("subjectKey is required.");
  try {
    return Response.json(await getSubjectDetail(subjectKey));
  } catch (error) {
    const normalized = normalizeApplicationError(error, "Could not load subject detail.");
    return badRequest(normalized.message, normalized.status);
  }
}
