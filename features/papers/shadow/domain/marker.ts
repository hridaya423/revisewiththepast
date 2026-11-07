import type { ShadowArtifactKind } from "../contracts/shadow-paper";

/**
 * Printed on every page of a shadow artifact so a scan or upload can never be
 * mistaken for the official paper it shadows.
 */
export function shadowMarkerText(kind: ShadowArtifactKind, displayCode: string) {
  return `${kind === "paper" ? "SHADOW PAPER" : "SHADOW MARK SCHEME"} ${displayCode}`;
}

export const SHADOW_MARKER_PATTERN = /\bSHADOW\s+(?:PAPER|MARK\s+SCHEME)\s+(SH-[A-Z2-9]{4}-[A-Z2-9]{4})\b/u;

export function findShadowMarker(text: string): string | null {
  return SHADOW_MARKER_PATTERN.exec(text.replace(/\s+/gu, " "))?.[1] ?? null;
}
