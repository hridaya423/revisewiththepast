import { NextRequest } from "next/server";

import { getPrivateMarkingFileSource } from "@/features/papers/marking/infrastructure/private-files";
import { requireAuthToken, unauthorizedResponse } from "@/shared/infrastructure/auth/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };

export async function GET(request: NextRequest, context: { params: Promise<{ fileId: string }> }) {
  if (!await requireAuthToken(request.headers).catch(() => null)) return unauthorizedResponse();
  const { fileId } = await context.params;
  if (!/^[a-z0-9]+$/i.test(fileId)) return new Response("File not found.", { status: 404, headers: privateHeaders });
  try {
    const source = await getPrivateMarkingFileSource(fileId);
    if (!source) return new Response("File not found.", { status: 404, headers: privateHeaders });
    const range = request.headers.get("range");
    const response = await fetch(source.url, { cache: "no-store", headers: range ? { Range: range } : {} });
    if (!response.ok) return new Response("This file is unavailable. Please try again.", { status: response.status === 416 ? 416 : 503, headers: privateHeaders });
    const headers = new Headers({
      ...privateHeaders, "Content-Type": source.contentType,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(source.fileName)}`,
    });
    for (const name of ["content-length", "content-range", "accept-ranges"]) {
      const value = response.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(response.body, { status: response.status, headers });
  } catch {
    return new Response("This file is unavailable. Please try again.", { status: 503, headers: privateHeaders });
  }
}
