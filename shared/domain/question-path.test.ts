import { describe, expect, it } from "vitest";
import { compareQuestionPaths, parseQuestionPathFromPrompt } from "./question-path";

describe("question paths", () => {
  it("preserves nested letter and roman subparts", () => {
    expect(parseQuestionPathFromPrompt("4 (b) (ii) Explain your answer.", "4", "ii")).toEqual(["b", "ii"]);
  });

  it("falls back to the declared part when the prompt omits its marker", () => {
    expect(parseQuestionPathFromPrompt("Explain your answer.", "4", "c")).toEqual(["c"]);
  });

  it("orders parent letter parts before nested roman parts", () => {
    expect(compareQuestionPaths(["b"], ["b", "i"])).toBe(-1);
    expect(compareQuestionPaths(["c"], ["b", "ii"])).toBe(1);
  });

  it("orders roman subparts numerically", () => {
    expect(compareQuestionPaths(["ii"], ["iii"])).toBeLessThan(0);
    expect(compareQuestionPaths(["iii"], ["iv"])).toBeLessThan(0);
    expect(compareQuestionPaths(["iv"], ["v"])).toBeLessThan(0);
  });
});
