import { findShadowMarker } from "../domain/marker";

export const SHADOW_MARKING_UNSUPPORTED_MESSAGE =
  "Shadow papers can't be marked automatically yet. Check your answers against the shadow mark scheme that has the same variant code.";

export const SHADOW_IMPORT_UNSUPPORTED_MESSAGE =
  "This PDF is a shadow paper, not the original exam, so it can't be marked against the original mark scheme. Check it with the matching shadow mark scheme instead.";

type SavedPaperKind = { generationKind?: string | null } | null | undefined;

/** Shadow variants change every number, so the original paper's answers must never score them. */
export function isShadowSavedPaper(savedPaper: SavedPaperKind) {
  return savedPaper?.generationKind === "shadow";
}

/** Returns the variant code when any page carries the printed shadow marker. */
export function detectShadowVariantInPages(pages: ReadonlyArray<{ text: string }>): string | null {
  for (const page of pages) {
    const code = findShadowMarker(page.text);
    if (code) return code;
  }
  return null;
}
