import { NextRequest } from "next/server";

import { generateMarkScheme, generateMarkSchemeRequestSchema } from "@/features/papers/server";
import { normalizeApplicationError } from "@/shared/application/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badRequest(message: string, status = 400) {
  return new Response(message, { status });
}

export async function POST(request: NextRequest) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return badRequest("Invalid JSON body");
  }
  const parsed = generateMarkSchemeRequestSchema.safeParse(rawBody);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Invalid mark scheme request.");
  try {
    const result = await generateMarkScheme(parsed.data);
    return new Response(Buffer.from(result.bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${result.fileName}"`,
        "X-Mark-Scheme-Included": String(result.includedCount),
        "X-Mark-Scheme-Failures": String(result.failures.length),
      },
    });
  } catch (error) {
    const normalized = normalizeApplicationError(error, "Failed to generate mark scheme.");
    console.error("Mark scheme generation failed", { subjectKey: parsed.data.subjectKey, unitCount: parsed.data.selectedUnitKeys.length, message: normalized.message });
    return badRequest(normalized.message, normalized.status);
  }
}
