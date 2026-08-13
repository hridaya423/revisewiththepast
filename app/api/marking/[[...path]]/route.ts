import { NextRequest } from "next/server";

import { POST as autoScore } from "@/features/papers/marking/infrastructure/http/auto-score";
import { POST as importFinishedPaper } from "@/features/papers/marking/infrastructure/http/import-finished-paper";
import { GET as markScheme } from "@/features/papers/marking/infrastructure/http/mark-scheme";
import { POST as ocr } from "@/features/papers/marking/infrastructure/http/ocr";
import { POST as score } from "@/features/papers/marking/infrastructure/http/score";
import { GET as submission } from "@/features/papers/marking/infrastructure/http/submission";
import { POST as submissions } from "@/features/papers/marking/infrastructure/http/submissions";
import { POST as uploads } from "@/features/papers/marking/infrastructure/http/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ path?: string[] }> };

export async function GET(request: NextRequest, context: Context) {
  const path = (await context.params).path ?? [];
  if (path.length === 2 && path[0] === "submissions") {
    return submission(request, { params: Promise.resolve({ submissionId: path[1] }) });
  }
  if (path.length === 3 && path[0] === "submissions" && path[2] === "mark-scheme") {
    return markScheme(request, { params: Promise.resolve({ submissionId: path[1] }) });
  }
  return new Response("Not found", { status: 404 });
}

export async function POST(request: NextRequest, context: Context) {
  const path = (await context.params).path?.join("/");
  const handlers: Record<string, (request: NextRequest) => Promise<Response>> = {
    "auto-score": autoScore,
    "import-finished-paper": importFinishedPaper,
    ocr,
    score,
    submissions,
    uploads,
  };
  return path && handlers[path] ? handlers[path](request) : new Response("Not found", { status: 404 });
}
