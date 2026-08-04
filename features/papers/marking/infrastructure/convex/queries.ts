import "server-only";

import { api } from "@/convex/_generated/api";
import { fetchAuthQuery } from "@/shared/infrastructure/auth/convex";
import type { Id } from "@/convex/_generated/dataModel";

export async function getCurrentUser() {
  return fetchAuthQuery(api.auth.getCurrentUser, {});
}

export async function listMarkingSubmissions() {
  return fetchAuthQuery(api.marking.listMarkingSubmissions, {});
}

export async function listSavedPapers() {
  return fetchAuthQuery(api.savedPapers.listSavedPapers, {});
}

export async function getSavedPaper(savedPaperId: string) {
  return fetchAuthQuery(api.savedPapers.getSavedPaper, { savedPaperId: savedPaperId as Id<"savedPapers"> });
}

export function getSavedPaperByImportKey(importKey: string) {
  return fetchAuthQuery(api.savedPapers.getSavedPaperByImportKey, { importKey });
}
