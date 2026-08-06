import { describe, expect, it } from "vitest";
import { buildStructuredLines, detectPageQuestionNumber, normalizeQuestionNumber } from "./text-structure";

describe("mark-scheme text structure", () => {
  it("groups positioned text into the expected columns", () => {
    expect(buildStructuredLines(2, [
      { text: "Question", x: 20, y: 100 },
      { text: "answer", x: 140, y: 100 },
      { text: "2", x: 220, y: 100 },
      { text: "scheme", x: 300, y: 100 },
      { text: "guidance", x: 600, y: 100 },
    ])).toEqual([{
      pageNumber: 2,
      y: 99,
      leftText: "Question",
      answerText: "answer",
      markText: "2",
      schemeText: "scheme",
      guidanceText: "guidance",
      fullText: "Question answer 2 scheme guidance",
    }]);
  });

  it("detects question numbers from headers and left-column parts", () => {
    expect(detectPageQuestionNumber({ pageNumber: 1, text: "Additional guidance 07", lines: [] })).toBe("7");
    expect(detectPageQuestionNumber({
      pageNumber: 2,
      text: "",
      lines: [{ pageNumber: 2, y: 1, leftText: "12 (b)", answerText: "", markText: "", schemeText: "", guidanceText: "", fullText: "12 (b)" }],
    })).toBe("12");
  });

  it("uses source page geometry for landscape mark-scheme columns", () => {
    expect(buildStructuredLines(2, [
      { text: "Question", x: 20, y: 100 },
      { text: "answer", x: 80, y: 100 },
      { text: "2", x: 170, y: 100 },
      { text: "scheme", x: 230, y: 100 },
      { text: "guidance", x: 600, y: 100 },
    ], 841.89)).toEqual([{
      pageNumber: 2,
      y: 99,
      leftText: "Question",
      answerText: "answer",
      markText: "2",
      schemeText: "scheme",
      guidanceText: "guidance",
      fullText: "Question answer 2 scheme guidance",
    }]);
  });

  it("normalizes numeric question tokens without changing non-numeric labels", () => {
    expect(normalizeQuestionNumber("007")).toBe("7");
    expect(normalizeQuestionNumber("A")).toBe("A");
  });
});
