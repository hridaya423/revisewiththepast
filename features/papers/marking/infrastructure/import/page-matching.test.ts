import { describe, expect, it } from "vitest";
import { normalizeSearchText, scorePromptMatch } from "./page-matching";

describe("finished-paper page matching", () => {
  it("normalizes punctuation and repeated whitespace for matching", () => {
    expect(normalizeSearchText("  River-valley, erosion! ")).toBe("river valley erosion");
  });

  it("scores shared prompt tokens while ignoring empty prompts", () => {
    expect(scorePromptMatch("Explain river erosion and deposition", "Explain river erosion", null)).toBe(1);
    expect(scorePromptMatch("unrelated page text", "", null)).toBe(0);
  });
});
