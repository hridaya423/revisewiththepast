import { describe, expect, it } from "vitest";

import { extractExamSession } from "./paper-asset-metadata";

describe("paper asset metadata", () => {
  it.each([
    ["aqa-81321-ms-jun23-pdf", "june"],
    ["paper-2-mark-scheme-november-2023", "november"],
    ["question-paper-jan_24", "january"],
    ["paper-1-mark-scheme", "unknown"],
  ] as const)("extracts the session from %s", (fileName, expected) => {
    expect(extractExamSession(fileName)).toBe(expected);
  });
});
