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

export async function uploadResponsePage(formData: FormData) {
  const response = await assertOk(await fetch("/api/marking/uploads", { method: "POST", body: formData }), "Could not upload response page.");
  return z.object({ pageId: z.string(), imageUrl: z.string(), questionKeys: z.array(z.string()) }).parse(await response.json());
}

export async function setResponsePageMapping(input: { submissionId: string; pageId: string; questionKeys: string[] }) {
  const response = await assertOk(await fetch("/api/marking/page-mapping", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }), "Could not update this page.");
  return z.object({ questionKeys: z.array(z.string()) }).parse(await response.json());
}

export async function importFinishedPaper(formData: FormData) {
  const response = await assertOk(await fetch("/api/marking/import-finished-paper", { method: "POST", body: formData }), "Could not import the finished paper PDF.");
  return submissionResponseSchema.parse(await response.json());
}

export async function createMarkingSubmission(input: { savedPaperId?: string; newAttempt?: boolean; boardCode?: string; subjectSlug?: string; subjectKey?: string }) {
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

const currentScoreSchema = z.object({ awardedMarks: z.number(), maxMarks: z.number(), needsReview: z.boolean(), rationale: z.string(), scoreStatus: z.enum(["ai_suggested", "confirmed"]), updatedAt: z.number() });
const saveScoreResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("saved"), updatedAt: z.number().nullable() }),
  z.object({ status: z.literal("conflict"), current: currentScoreSchema }),
]);
export type SaveScoreResult = z.infer<typeof saveScoreResponseSchema>;

export async function saveScore(input: { submissionId: string; questionKey: string; awardedMarks: number; maxMarks: number; needsReview: boolean; rationale: string; evidence: unknown; expectedUpdatedAt: number | null }): Promise<SaveScoreResult> {
  const response = await fetch("/api/marking/score", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  if (response.status === 409) return saveScoreResponseSchema.parse(await response.json());
  await assertOk(response, "Could not save score.");
  return saveScoreResponseSchema.parse(await response.json());
}

export async function loadCombinedMarkScheme(submissionId: string) {
  const response = await fetch(`/api/marking/submissions/${submissionId}/mark-scheme`);
  await assertOk(response, "Could not load combined mark scheme.");
  return combinedMarkSchemeResponseSchema.parse(await response.json()) satisfies { entries: CombinedMarkSchemeEntry[]; combinedText: string; failures?: Array<{ questionKey: string; error: string }> };
}
