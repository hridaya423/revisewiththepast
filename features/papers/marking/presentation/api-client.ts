import { z } from "zod";

type CombinedMarkSchemeEntry = {
  questionKey: string;
  label: string;
  markScheme: {
    partText: string;
    questionText: string;
    pageNumbers: number[];
    markSchemeUrl: string;
  };
};

const submissionResponseSchema = z.object({ submissionId: z.string().min(1) });
const combinedMarkSchemeResponseSchema = z.object({
  entries: z.array(z.object({
    questionKey: z.string(),
    label: z.string(),
    markScheme: z.object({
      partText: z.string(),
      questionText: z.string(),
      pageNumbers: z.array(z.number()),
      markSchemeUrl: z.string(),
    }),
  })),
  combinedText: z.string(),
  failures: z.array(z.object({ questionKey: z.string(), error: z.string() })).optional(),
});

async function assertOk(response: Response, fallback: string) {
  if (response.ok) return response;
  throw new Error((await response.text()) || fallback);
}

export function uploadResponsePage(formData: FormData) {
  return fetch("/api/marking/uploads", { method: "POST", body: formData }).then((response) => assertOk(response, "Could not upload response page."));
}

export async function importFinishedPaper(formData: FormData) {
  const response = await assertOk(await fetch("/api/marking/import-finished-paper", { method: "POST", body: formData }), "Could not import the finished paper PDF.");
  return submissionResponseSchema.parse(await response.json());
}

export async function createMarkingSubmission(input: { savedPaperId?: string; boardCode?: string; subjectSlug?: string; subjectKey?: string }) {
  const response = await fetch("/api/marking/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  await assertOk(response, "Could not start marking this paper.");
  return submissionResponseSchema.parse(await response.json());
}

export function runOcr(input: { submissionId: string; questionKey: string }) {
  return fetch("/api/marking/ocr", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }).then((response) => assertOk(response, "Could not run OCR."));
}

export function autoScoreQuestion(input: { submissionId: string; questionKey: string }) {
  return fetch("/api/marking/auto-score", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }).then((response) => assertOk(response, "Could not auto-score this question."));
}

export function autoScoreWholePaper(submissionId: string) {
  return fetch("/api/marking/auto-score", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ submissionId, scoreWholePaper: true }) }).then((response) => assertOk(response, "Could not auto-score the full paper."));
}

export function saveScore(input: Record<string, unknown>) {
  return fetch("/api/marking/score", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }).then((response) => assertOk(response, "Could not save score."));
}

export async function loadCombinedMarkScheme(submissionId: string) {
  const response = await fetch(`/api/marking/submissions/${submissionId}/mark-scheme`);
  await assertOk(response, "Could not load combined mark scheme.");
  return combinedMarkSchemeResponseSchema.parse(await response.json()) satisfies { entries: CombinedMarkSchemeEntry[]; combinedText: string; failures?: Array<{ questionKey: string; error: string }> };
}
