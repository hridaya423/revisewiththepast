import { NextRequest } from "next/server";

import { POST as generate } from "@/features/papers/builder/infrastructure/http/generate";
import { POST as generateMarkScheme } from "@/features/papers/builder/infrastructure/http/generate-mark-scheme";
import { POST as saveGenerated } from "@/features/papers/builder/infrastructure/http/save-generated";
import { GET as subjectDetail } from "@/features/papers/builder/infrastructure/http/subject-detail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ path?: string[] }> };

export async function GET(request: NextRequest, context: Context) {
  const path = (await context.params).path?.join("/");
  return path === "subject-detail" ? subjectDetail(request) : new Response("Not found", { status: 404 });
}

export async function POST(request: NextRequest, context: Context) {
  const path = (await context.params).path?.join("/");
  const handlers: Record<string, (request: NextRequest) => Promise<Response>> = {
    generate,
    "generate-mark-scheme": generateMarkScheme,
    "save-generated": saveGenerated,
  };
  return path && handlers[path] ? handlers[path](request) : new Response("Not found", { status: 404 });
}
