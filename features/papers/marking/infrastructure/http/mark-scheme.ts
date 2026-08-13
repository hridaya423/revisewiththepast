import { requireAuthToken, unauthorizedResponse } from "@/shared/infrastructure/auth/tokens";
import { getCombinedMarkScheme } from "@/features/papers/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ submissionId: string }>;
};

function badRequest(message: string, status = 400) {
  return new Response(message, { status });
}

export async function GET(request: Request, context: RouteContext) {
  const authToken = await requireAuthToken(request.headers).catch(() => null);
  if (!authToken) return unauthorizedResponse();

  const { submissionId } = await context.params;
  if (!submissionId) return badRequest("submissionId is required.");

  try {
    const combined = await getCombinedMarkScheme(submissionId);
    if (!combined) return badRequest("Submission not found.", 404);
    return Response.json(combined);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unauthorized")) return unauthorizedResponse();
    return badRequest(`Failed to build mark scheme: ${error instanceof Error ? error.message : String(error)}`, 500);
  }
}
