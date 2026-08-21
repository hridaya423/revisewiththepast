import { requireAuthToken, unauthorizedResponse } from "@/shared/infrastructure/auth/tokens";
import { getSubmission } from "@/features/papers/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    submissionId: string;
  }>;
};

function badRequest(message: string, status = 400) {
  return new Response(message, { status });
}

function isUnauthorizedError(error: unknown) {
  return error instanceof Error && error.message.includes("Unauthorized");
}

export async function GET(_request: Request, context: RouteContext) {
  const authToken = await requireAuthToken(_request.headers).catch(() => null);
  if (!authToken) return unauthorizedResponse();

  const { submissionId } = await context.params;
  if (!submissionId) return badRequest("submissionId is required.");

  try {
    const bundle = await getSubmission(submissionId);
    if (!bundle) return badRequest("Submission not found.", 404);
    return Response.json(bundle);
  } catch (error) {
    if (isUnauthorizedError(error)) return unauthorizedResponse();
    console.error("Submission load failed", {
      submissionId,
      message: error instanceof Error ? error.message : String(error),
    });
    return badRequest("Failed to load submission.", 500);
  }
}
